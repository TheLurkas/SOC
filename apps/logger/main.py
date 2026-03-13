#!/usr/bin/env python3
"""
FortiGate Real-Time Log Listener (Syslog Server)

Receives syslog from a FortiGate firewall, buffers raw messages, and
periodically sends them to an LLM for structured parsing before forwarding
to the SOC platform's ingest API.

Trigger conditions (whichever fires first):
  - Buffer reaches --batch-size logs (default: 10)
  - --flush-interval seconds have elapsed (default: 30)

Burst protection: a bounded queue (--max-pending, default: 5) decouples
buffering from the single LLM worker thread. If the queue is full, the
batch falls back to regex parsing and is sent directly — no logs are dropped.

SETUP ON FORTIGATE (CLI):
    config log syslogd setting
        set status enable
        set server 192.168.1.3
        set port 514
        set facility local7
        set format default
    end

    config log syslogd filter
        set severity information
        set forward-traffic enable
        set local-traffic enable
        set multicast-traffic enable
        set anomaly enable
        set voip enable
    end

USAGE:
    # Listen only (no ingestion):
        python main.py --port 514

    # Listen and ingest (LLM parsing):
        python main.py --port 514 --workspace-id <CUID> --api-url http://localhost:3001 --openai-key sk-...

    # With raw output and file logging:
        python main.py --port 514 --workspace-id <ID> --openai-key sk-... --raw --output logs.txt
"""

import argparse
import datetime
import json
import queue
import re
import signal
import socketserver
import sys
import threading
import time
import urllib.request
import urllib.error
from collections import defaultdict

COLORS = {
    "emergency": "\033[91;1m",
    "alert":     "\033[91m",
    "critical":  "\033[31;1m",
    "error":     "\033[31m",
    "warning":   "\033[33m",
    "notice":    "\033[36m",
    "info":      "\033[32m",
    "debug":     "\033[90m",
    "traffic":   "\033[34m",
    "event":     "\033[35m",
    "utm":       "\033[33;1m",
    "reset":     "\033[0m",
    "timestamp": "\033[90m",
    "header":    "\033[1;37m",
    "success":   "\033[32;1m",
}

stats = defaultdict(int)

# map FortiGate level names to our severity enum
LEVEL_TO_SEVERITY = {
    "emergency": "critical",
    "alert": "critical",
    "critical": "critical",
    "error": "high",
    "warning": "medium",
    "notice": "low",
    "information": "low",
    "debug": "unknown",
}

# IANA protocol numbers
PROTO_MAP = {
    "1": "icmp",
    "6": "tcp",
    "17": "udp",
    "47": "gre",
    "50": "esp",
    "51": "ah",
    "58": "icmpv6",
    "89": "ospf",
}


def parse_fortigate_log(raw_message: str) -> dict:
    """Parse a FortiGate syslog message into key-value pairs."""
    fields = {}
    pattern = r'(\w+)=(?:"([^"]*?)"|(\S+))'
    for match in re.finditer(pattern, raw_message):
        key = match.group(1)
        value = match.group(2) if match.group(2) is not None else match.group(3)
        fields[key] = value
    return fields


def fortigate_to_ingest(fields: dict, workspace_id: str, raw_message: str) -> dict:
    """Convert parsed FortiGate fields to the /logs/ingest payload format (regex fallback)."""
    eventtime = fields.get("eventtime", "")
    if eventtime and len(eventtime) > 10:
        timestamp = int(eventtime[:10])
    elif eventtime:
        timestamp = int(eventtime)
    else:
        timestamp = int(time.time())

    level = fields.get("crlevel", fields.get("level", "")).lower()
    severity = LEVEL_TO_SEVERITY.get(level, "unknown")

    proto_raw = fields.get("proto", "")
    protocol = PROTO_MAP.get(proto_raw, proto_raw) if proto_raw else None

    srcport = fields.get("srcport")
    dstport = fields.get("dstport")

    return {
        "workspaceId": workspace_id,
        "timestamp": timestamp,
        "severity": severity,
        "vendor": "fortigate",
        "eventType": fields.get("type", "unknown"),
        "action": fields.get("action") or None,
        "application": fields.get("app", fields.get("service")) or None,
        "protocol": protocol,
        "policy": fields.get("policyid") or None,
        "sourceIp": fields.get("srcip") or None,
        "sourcePort": int(srcport) if srcport and srcport.isdigit() else None,
        "destinationIp": fields.get("dstip") or None,
        "destinationPort": int(dstport) if dstport and dstport.isdigit() else None,
        "srcCountry": fields.get("srccountry") or None,
        "dstCountry": fields.get("dstcountry") or None,
        "rawLog": raw_message,
    }


def get_severity_color(fields: dict) -> str:
    log_type = fields.get("type", "").lower()
    level = fields.get("level", fields.get("pri", "")).lower()

    if level in ("emergency", "alert", "critical"):
        return COLORS["critical"]
    elif level == "error":
        return COLORS["error"]
    elif level == "warning":
        return COLORS["warning"]
    elif log_type == "traffic":
        return COLORS["traffic"]
    elif log_type == "event":
        return COLORS["event"]
    elif log_type == "utm":
        return COLORS["utm"]
    elif level == "notice":
        return COLORS["notice"]
    else:
        return COLORS["info"]


def format_log(raw_message: str, use_color: bool = True) -> str:
    fields = parse_fortigate_log(raw_message)
    reset = COLORS["reset"] if use_color else ""
    ts_color = COLORS["timestamp"] if use_color else ""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not fields:
        return f"{ts_color}[{now}]{reset} {raw_message}"

    color = get_severity_color(fields) if use_color else ""

    log_type = fields.get("type", "unknown")
    subtype = fields.get("subtype", "")
    level = fields.get("level", fields.get("pri", ""))
    action = fields.get("action", "")
    msg = fields.get("msg", fields.get("message", ""))
    srcip = fields.get("srcip", "")
    dstip = fields.get("dstip", "")
    srcport = fields.get("srcport", "")
    dstport = fields.get("dstport", "")
    proto = fields.get("proto", fields.get("service", ""))
    policy = fields.get("policyid", "")
    user = fields.get("user", fields.get("srcuser", ""))

    stats[log_type] += 1
    if level:
        stats[f"level:{level}"] += 1

    parts = [f"{ts_color}[{now}]{reset}"]
    parts.append(f"{color}[{log_type.upper()}")
    if subtype:
        parts[-1] += f"/{subtype}"
    parts[-1] += "]"
    if level:
        parts.append(f"[{level.upper()}]")
    if action:
        parts.append(f"action={action}")

    if srcip and dstip:
        flow = f"{srcip}"
        if srcport:
            flow += f":{srcport}"
        flow += f" -> {dstip}"
        if dstport:
            flow += f":{dstport}"
        if proto:
            flow += f" ({proto})"
        parts.append(flow)

    if policy:
        parts.append(f"policy={policy}")
    if user:
        parts.append(f"user={user}")
    if msg:
        parts.append(f'"{msg}"')

    parts.append(reset)
    return " ".join(parts)


# LLM system prompt — tells the model exactly what to extract from raw FortiGate syslogs
_LLM_SYSTEM_PROMPT = """\
You are a FortiGate syslog parser. Given raw FortiGate syslog messages, extract structured \
fields and return a JSON object with a "logs" array — one entry per input message.

For each message extract:
- workspaceId: always use the workspace_id provided in the input
- timestamp: integer unix epoch (from eventtime field, keep only first 10 digits; \
fall back to current unix time if missing)
- severity: map FortiGate level → "critical" (emergency/alert/critical), "high" (error), \
"medium" (warning), "low" (notice/information), "unknown" (anything else or missing)
- vendor: always "fortigate"
- eventType: value of the 'type' field (e.g. traffic, threat, system, event)
- action: 'action' field or null
- application: 'app' field, fallback to 'service', or null
- protocol: translate 'proto' numeric field (1→icmp, 6→tcp, 17→udp, 47→gre, 50→esp, \
51→ah, 58→icmpv6, 89→ospf); if already a name keep it; null if missing
- policy: 'policyid' field or null
- sourceIp: 'srcip' field or null
- sourcePort: 'srcport' as integer or null
- destinationIp: 'dstip' field or null
- destinationPort: 'dstport' as integer or null
- srcCountry: 'srccountry' field or null
- dstCountry: 'dstcountry' field or null
- rawLog: the original raw log string, verbatim

Return ONLY valid JSON in this exact shape: {"logs": [...]}
"""


class LlmLogIngester:
    """
    Buffers incoming raw syslog messages and periodically parses them in
    batches via an LLM before forwarding structured results to the SOC API.

    Trigger conditions (whichever fires first):
      - buffer reaches batch_size logs
      - flush_interval seconds have elapsed

    Burst protection: batches are placed in a bounded queue consumed by a
    single worker thread. If the queue is full the batch falls back to
    regex parsing and is sent directly — no logs are dropped, no threads block.
    """

    def __init__(
        self,
        api_url: str,
        workspace_id: str,
        openai_key: str,
        batch_size: int = 10,
        flush_interval: float = 30.0,
        llm_model: str = "gpt-4.1-mini",
        max_pending: int = 5,
    ):
        self.api_url = api_url.rstrip("/")
        self.workspace_id = workspace_id
        self.openai_key = openai_key
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.llm_model = llm_model

        self._buffer: list[str] = []
        self._lock = threading.Lock()
        self._queue: queue.Queue = queue.Queue(maxsize=max_pending)
        self._running = True

        # stats
        self._sent = 0
        self._errors = 0
        self._llm_calls = 0
        self._fallbacks = 0

        self._worker = threading.Thread(target=self._llm_worker, daemon=True)
        self._worker.start()

        self._timer = threading.Thread(target=self._flush_loop, daemon=True)
        self._timer.start()

    def add(self, raw_message: str):
        with self._lock:
            self._buffer.append(raw_message)
            if len(self._buffer) >= self.batch_size:
                batch = self._buffer[:]
                self._buffer.clear()
            else:
                return
        self._enqueue_or_fallback(batch)

    def _flush_loop(self):
        while self._running:
            time.sleep(self.flush_interval)
            self.flush()

    def flush(self):
        with self._lock:
            if not self._buffer:
                return
            batch = self._buffer[:]
            self._buffer.clear()
        self._enqueue_or_fallback(batch)

    def _enqueue_or_fallback(self, batch: list[str]):
        try:
            self._queue.put_nowait(batch)
        except queue.Full:
            # LLM worker is behind — parse with regex and send directly
            print(
                f"{COLORS['warning']}  LLM queue full — regex fallback for "
                f"{len(batch)} log(s){COLORS['reset']}",
                file=sys.stderr, flush=True,
            )
            self._fallbacks += 1
            self._fallback_send(batch)

    def _llm_worker(self):
        while self._running:
            try:
                batch = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                logs = self._llm_parse(batch)
                self._send(logs)
                self._llm_calls += 1
            except Exception as e:
                print(
                    f"{COLORS['error']}  LLM parse failed ({e}) — regex fallback{COLORS['reset']}",
                    file=sys.stderr, flush=True,
                )
                self._fallbacks += 1
                self._fallback_send(batch)
            finally:
                self._queue.task_done()

    def _llm_parse(self, raw_logs: list[str]) -> list[dict]:
        """Call OpenAI to parse raw syslog lines into structured log dicts."""
        payload = json.dumps({
            "model": self.llm_model,
            "messages": [
                {"role": "system", "content": _LLM_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({
                    "workspace_id": self.workspace_id,
                    "raw_logs": raw_logs,
                })},
            ],
            "response_format": {"type": "json_object"},
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.openai_key}",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        content = result["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        logs = parsed.get("logs", [])

        # always enforce correct workspaceId regardless of what the LLM returned
        for log in logs:
            log["workspaceId"] = self.workspace_id

        return logs

    def _fallback_send(self, raw_logs: list[str]):
        """Regex-parse and send directly, bypassing the LLM."""
        batch = []
        for raw in raw_logs:
            fields = parse_fortigate_log(raw)
            if fields:
                batch.append(fortigate_to_ingest(fields, self.workspace_id, raw))
        self._send(batch)

    def _send(self, batch: list[dict]):
        if not batch:
            return
        url = f"{self.api_url}/logs/ingest"
        data = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10):
                self._sent += len(batch)
        except urllib.error.HTTPError as e:
            self._errors += len(batch)
            body = e.read().decode("utf-8", errors="replace")[:200]
            print(f"{COLORS['error']}  INGEST ERROR ({e.code}): {body}{COLORS['reset']}",
                  file=sys.stderr, flush=True)
        except Exception as e:
            self._errors += len(batch)
            print(f"{COLORS['error']}  INGEST ERROR: {e}{COLORS['reset']}",
                  file=sys.stderr, flush=True)

    def stop(self):
        self._running = False
        self.flush()
        self._queue.join()

    def print_stats(self):
        print(f"  Logs sent to API : {COLORS['success']}{self._sent}{COLORS['reset']}")
        print(f"  LLM batches      : {COLORS['info']}{self._llm_calls}{COLORS['reset']}")
        if self._fallbacks:
            print(f"  Regex fallbacks  : {COLORS['warning']}{self._fallbacks}{COLORS['reset']}")
        if self._errors:
            print(f"  Ingest errors    : {COLORS['error']}{self._errors}{COLORS['reset']}")


class SyslogHandler(socketserver.BaseRequestHandler):

    def handle(self):
        data = self.request[0].strip()
        try:
            message = data.decode("utf-8", errors="replace")
        except Exception:
            message = str(data)

        # strip syslog priority header
        message = re.sub(r"^<\d+>", "", message).strip()

        if self.server.log_filter:
            if self.server.log_filter.lower() not in message.lower():
                return

        formatted = format_log(message, use_color=self.server.use_color)
        print(formatted, flush=True)

        if self.server.show_raw:
            raw_color = COLORS["timestamp"] if self.server.use_color else ""
            reset = COLORS["reset"] if self.server.use_color else ""
            print(f"{raw_color}  RAW: {message}{reset}", flush=True)

        if self.server.ingester:
            self.server.ingester.add(message)

        if self.server.log_file:
            plain = format_log(message, use_color=False)
            try:
                self.server.log_file.write(plain + "\n")
                self.server.log_file.flush()
            except Exception as e:
                print(f"Error writing to log file: {e}", file=sys.stderr)


class SyslogServer(socketserver.UDPServer):
    allow_reuse_address = True

    def __init__(self, server_address, handler_class, log_filter=None,
                 log_file=None, use_color=True, show_raw=False, ingester=None):
        super().__init__(server_address, handler_class)
        self.log_filter = log_filter
        self.log_file = log_file
        self.use_color = use_color
        self.show_raw = show_raw
        self.ingester = ingester


def print_banner(host: str, port: int, log_filter: str, output_file: str,
                 workspace_id: str = None, api_url: str = None,
                 llm_model: str = None, batch_size: int = None,
                 flush_interval: float = None, max_pending: int = None):
    if workspace_id:
        ingest_line = f"{COLORS['success']}{api_url} -> {workspace_id}{COLORS['reset']}"
        llm_line = (
            f"{COLORS['info']}{llm_model}{COLORS['reset']}  "
            f"batch={batch_size}  interval={flush_interval}s  "
            f"max_pending={max_pending}"
        )
    else:
        ingest_line = f"{COLORS['timestamp']}disabled (no --workspace-id){COLORS['reset']}"
        llm_line = f"{COLORS['timestamp']}disabled{COLORS['reset']}"

    print(f"""
{COLORS['header']}╔══════════════════════════════════════════════════════════╗
║          FortiGate Real-Time Log Listener                ║
╚══════════════════════════════════════════════════════════╝{COLORS['reset']}

  Listening on : {COLORS['info']}{host}:{port}{COLORS['reset']}
  Filter       : {COLORS['info']}{log_filter or 'None (showing all)'}{COLORS['reset']}
  Output file  : {COLORS['info']}{output_file or 'None (console only)'}{COLORS['reset']}
  API ingest   : {ingest_line}
  LLM parser   : {llm_line}

  {COLORS['timestamp']}Press Ctrl+C to stop and show statistics{COLORS['reset']}

{COLORS['header']}{'─' * 58}{COLORS['reset']}
""")


def print_stats_report(ingester=None):
    if not stats and not ingester:
        return

    print(f"\n{COLORS['header']}{'─' * 58}")
    print(f"  Log Statistics")
    print(f"{'─' * 58}{COLORS['reset']}")

    total = sum(v for k, v in stats.items() if not k.startswith("level:"))
    type_stats = {k: v for k, v in stats.items() if not k.startswith("level:")}
    level_stats = {k.replace("level:", ""): v for k, v in stats.items() if k.startswith("level:")}

    if type_stats:
        print(f"\n  By Type:")
        for log_type, count in sorted(type_stats.items(), key=lambda x: -x[1]):
            bar = "█" * min(count, 40)
            print(f"    {log_type:<15} {count:>6}  {COLORS['info']}{bar}{COLORS['reset']}")

    if level_stats:
        print(f"\n  By Severity:")
        for level, count in sorted(level_stats.items(), key=lambda x: -x[1]):
            print(f"    {level:<15} {count:>6}")

    print(f"\n  {COLORS['header']}Total logs received: {total}{COLORS['reset']}")

    if ingester:
        ingester.print_stats()

    print()


def main():
    parser = argparse.ArgumentParser(
        description="FortiGate Real-Time Log Listener with LLM-powered SOC ingestion",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py --port 514                                             # Listen only
  python main.py --port 514 --workspace-id abc123 --openai-key sk-...  # LLM ingestion
  python main.py --port 514 --workspace-id abc123 --openai-key sk-... --batch-size 20 --flush-interval 60
  python main.py --port 514 --workspace-id abc123 --openai-key sk-... --raw
        """,
    )
    parser.add_argument("--host", default="0.0.0.0",
                        help="IP to listen on (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=514,
                        help="UDP port to listen on (default: 514)")
    parser.add_argument("--filter", dest="log_filter", default=None,
                        help="Only show logs containing this keyword")
    parser.add_argument("--output", default=None,
                        help="Save logs to this file")
    parser.add_argument("--no-color", action="store_true",
                        help="Disable colored output")
    parser.add_argument("--raw", action="store_true",
                        help="Also print the raw syslog message below each formatted line")

    # API ingestion
    parser.add_argument("--workspace-id", default=None,
                        help="Workspace ID to ingest logs into (enables API forwarding)")
    parser.add_argument("--api-url", default="http://localhost:3001",
                        help="SOC API base URL (default: http://localhost:3001)")

    # LLM parsing
    parser.add_argument("--openai-key", default=None,
                        help="OpenAI API key for LLM-powered log parsing")
    parser.add_argument("--llm-model", default="gpt-4.1-mini",
                        help="OpenAI model to use for parsing (default: gpt-4.1-mini)")
    parser.add_argument("--batch-size", type=int, default=10,
                        help="Trigger LLM parse after this many logs (default: 10)")
    parser.add_argument("--flush-interval", type=float, default=30.0,
                        help="Trigger LLM parse after this many seconds (default: 30)")
    parser.add_argument("--max-pending", type=int, default=5,
                        help="Max queued LLM batches before falling back to regex (default: 5)")

    args = parser.parse_args()
    log_file = None
    ingester = None

    if args.output:
        log_file = open(args.output, "a", encoding="utf-8")

    if args.workspace_id:
        if not args.openai_key:
            print(
                f"{COLORS['error']}ERROR: --openai-key is required when --workspace-id is set{COLORS['reset']}",
                file=sys.stderr,
            )
            sys.exit(1)
        ingester = LlmLogIngester(
            api_url=args.api_url,
            workspace_id=args.workspace_id,
            openai_key=args.openai_key,
            batch_size=args.batch_size,
            flush_interval=args.flush_interval,
            llm_model=args.llm_model,
            max_pending=args.max_pending,
        )

    print_banner(
        args.host, args.port, args.log_filter, args.output,
        args.workspace_id, args.api_url,
        args.llm_model, args.batch_size, args.flush_interval, args.max_pending,
    )

    server = SyslogServer(
        (args.host, args.port),
        SyslogHandler,
        log_filter=args.log_filter,
        log_file=log_file,
        use_color=not args.no_color,
        show_raw=args.raw,
        ingester=ingester,
    )

    def shutdown(sig, frame):
        print(f"\n\n{COLORS['warning']}Shutting down...{COLORS['reset']}")
        if ingester:
            ingester.stop()
        print_stats_report(ingester)
        if log_file:
            log_file.close()
        server.server_close()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        shutdown(None, None)


if __name__ == "__main__":
    main()
