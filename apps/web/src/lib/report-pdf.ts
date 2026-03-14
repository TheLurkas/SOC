import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SecurityReportDto } from "@soc/shared";

const COLORS = {
  primary: [30, 41, 59] as [number, number, number],     // slate-800
  accent: [56, 189, 248] as [number, number, number],    // sky-400
  muted: [100, 116, 139] as [number, number, number],    // slate-500
  white: [255, 255, 255] as [number, number, number],
  bg: [15, 23, 42] as [number, number, number],          // slate-900
  critical: [239, 68, 68] as [number, number, number],
  high: [249, 115, 22] as [number, number, number],
  medium: [234, 179, 8] as [number, number, number],
  low: [59, 130, 246] as [number, number, number],
};

function riskColor(level: string): [number, number, number] {
  switch (level) {
    case "critical": return COLORS.critical;
    case "high": return COLORS.high;
    case "medium": return COLORS.medium;
    default: return COLORS.low;
  }
}

async function loadLogoBase64(): Promise<string | null> {
  try {
    const res = await fetch("/logo.png");
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateReportPdf(report: SecurityReportDto) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const logoBase64 = await loadLogoBase64();

  function checkPage(needed: number) {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = margin;
    }
  }

  function heading(text: string, size: number = 14) {
    checkPage(12);
    doc.setFontSize(size);
    doc.setTextColor(...COLORS.accent);
    doc.setFont("helvetica", "bold");
    doc.text(text, margin, y);
    y += size * 0.5 + 2;
  }

  function body(text: string, maxWidth: number = contentWidth) {
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(text, maxWidth);
    checkPage(lines.length * 4 + 2);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 2;
  }

  function label(text: string) {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.setFont("helvetica", "normal");
    doc.text(text, margin, y);
    y += 4;
  }

  // ── Title page ──────────────────────────────────────────
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 70, "F");

  // logo top-right
  if (logoBase64) {
    doc.addImage(logoBase64, "PNG", pageWidth - margin - 35, 8, 35, 35);
  }

  doc.setFontSize(22);
  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.text(report.title, margin, 30);

  doc.setFontSize(10);
  doc.setTextColor(...COLORS.accent);
  const period = `${new Date(report.period.from).toLocaleDateString("en-GB")} - ${new Date(report.period.to).toLocaleDateString("en-GB")}`;
  doc.text(`Period: ${period}`, margin, 42);

  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text(`Generated: ${new Date(report.generatedAt).toLocaleString("en-GB")}`, margin, 50);

  // risk badge
  const rc = riskColor(report.overallRiskLevel);
  doc.setFillColor(...rc);
  doc.roundedRect(margin, 55, 40, 8, 2, 2, "F");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.text(`RISK: ${report.overallRiskLevel.toUpperCase()}`, margin + 3, 60.5);

  y = 80;

  // ── Executive Summary ───────────────────────────────────
  heading("Executive Summary");
  body(report.executiveSummary);
  y += 4;

  // ── Company sections ────────────────────────────────────
  for (const company of report.companies) {
    heading(`${company.name}`, 13);

    // company risk
    const crc = riskColor(company.companyRiskLevel);
    doc.setFillColor(...crc);
    doc.roundedRect(margin, y - 1, 35, 6, 1.5, 1.5, "F");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.white);
    doc.setFont("helvetica", "bold");
    doc.text(`Risk: ${company.companyRiskLevel.toUpperCase()}`, margin + 2, y + 3);
    y += 10;

    body(company.companySummary);
    y += 2;

    for (const ws of company.workspaces) {
      checkPage(40);
      heading(`Workspace: ${ws.name}`, 11);

      label(`Total logs: ${ws.totalLogs.toLocaleString()} | Open alerts in period`);
      y += 2;

      // severity table
      checkPage(20);
      autoTable(doc, {
        startY: y,
        margin: { left: margin },
        head: [["Critical", "High", "Medium", "Low"]],
        body: [[
          ws.severityBreakdown.critical,
          ws.severityBreakdown.high,
          ws.severityBreakdown.medium,
          ws.severityBreakdown.low,
        ]],
        theme: "grid",
        headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { textColor: COLORS.critical },
          1: { textColor: COLORS.high },
          2: { textColor: COLORS.medium },
          3: { textColor: COLORS.low },
        },
        tableWidth: contentWidth * 0.6,
      });
      y = (doc as any).lastAutoTable.finalY + 4;

      // top source IPs
      if (ws.topSourceIps.length > 0) {
        checkPage(20);
        label("Top Source IPs");
        autoTable(doc, {
          startY: y,
          margin: { left: margin },
          head: [["IP Address", "Count"]],
          body: ws.topSourceIps.map((ip) => [ip.ip, ip.count]),
          theme: "grid",
          headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          tableWidth: contentWidth * 0.5,
        });
        y = (doc as any).lastAutoTable.finalY + 4;
      }

      // top dest IPs
      if (ws.topDestinationIps.length > 0) {
        checkPage(20);
        label("Top Destination IPs");
        autoTable(doc, {
          startY: y,
          margin: { left: margin },
          head: [["IP Address", "Count"]],
          body: ws.topDestinationIps.map((ip) => [ip.ip, ip.count]),
          theme: "grid",
          headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          tableWidth: contentWidth * 0.5,
        });
        y = (doc as any).lastAutoTable.finalY + 4;
      }

      // top threats
      if (ws.topThreats.length > 0) {
        checkPage(15);
        label("Top Threats");
        for (const threat of ws.topThreats) {
          checkPage(6);
          doc.setFontSize(8);
          doc.setTextColor(60, 60, 60);
          doc.setFont("helvetica", "normal");
          const lines = doc.splitTextToSize(`- ${threat}`, contentWidth - 5);
          doc.text(lines, margin + 3, y);
          y += lines.length * 3.5 + 1;
        }
        y += 2;
      }

      // findings
      if (ws.findings) {
        checkPage(10);
        label("Findings");
        body(ws.findings);
      }

      // workspace recommendations
      if (ws.recommendations.length > 0) {
        checkPage(10);
        label("Recommendations");
        for (const rec of ws.recommendations) {
          checkPage(6);
          doc.setFontSize(8);
          doc.setTextColor(60, 60, 60);
          const lines = doc.splitTextToSize(`- ${rec}`, contentWidth - 5);
          doc.text(lines, margin + 3, y);
          y += lines.length * 3.5 + 1;
        }
        y += 4;
      }
    }

    y += 4;
  }

  // ── Overall Recommendations ─────────────────────────────
  if (report.recommendations.length > 0) {
    heading("Overall Recommendations");
    for (let i = 0; i < report.recommendations.length; i++) {
      checkPage(8);
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(`${i + 1}. ${report.recommendations[i]}`, contentWidth - 5);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4 + 2;
    }
    y += 4;
  }

  // ── Conclusion ──────────────────────────────────────────
  heading("Conclusion");
  body(report.conclusion);

  // ── Footer on all pages ─────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      `Page ${i} of ${pageCount} | Confidential`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" },
    );
  }

  const dateStr = new Date().toISOString().split("T")[0];
  doc.save(`security-report-${dateStr}.pdf`);
}
