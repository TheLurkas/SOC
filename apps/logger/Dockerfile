FROM python:3.12-alpine
RUN pip install --no-cache-dir paramiko
WORKDIR /app
COPY apps/logger/main.py .
COPY apps/logger/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
EXPOSE 514/udp
CMD ["/entrypoint.sh"]
