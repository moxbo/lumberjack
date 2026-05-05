/**
 * Onboarding helpers: demo log entries + Logback snippet
 * Used by the empty-state in App.tsx (OB-2 / OB-3).
 */
import type { RendererLogEntry } from "../types/renderer";

/**
 * Generates a small set of demo log entries so new users can immediately
 * explore filters, marks, search, MDC and stack-traces without any TCP/HTTP setup.
 */
export function buildDemoEntries(): RendererLogEntry[] {
  const base = Date.now() - 60_000;
  const mk = (
    offsetMs: number,
    level: string,
    logger: string,
    thread: string,
    message: string,
    extra: Partial<RendererLogEntry> = {},
  ): RendererLogEntry => ({
    timestamp: new Date(base + offsetMs).toISOString(),
    level,
    logger,
    thread,
    message,
    source: "demo",
    ...extra,
  });

  return [
    mk(0, "INFO", "com.example.App", "main", "Application starting up"),
    mk(
      120,
      "INFO",
      "com.example.config.AppConfig",
      "main",
      "Loaded 12 beans from configuration",
    ),
    mk(
      250,
      "DEBUG",
      "org.springframework.boot",
      "main",
      "Auto-configuration report enabled",
    ),
    mk(
      400,
      "INFO",
      "com.example.web.HttpServer",
      "boot-1",
      "HTTP listener bound to 0.0.0.0:8080",
      { mdc: { service: "checkout", env: "demo" } },
    ),
    mk(
      900,
      "INFO",
      "com.example.web.RequestLogger",
      "http-nio-8080-exec-1",
      "GET /api/orders/42 200 in 23ms",
      { mdc: { traceId: "a1b2c3d4", spanId: "11", userId: "u-100" } },
    ),
    mk(
      1500,
      "WARN",
      "com.example.cache.RedisClient",
      "redis-1",
      "Connection pool nearing capacity (18/20)",
      { mdc: { service: "checkout" } },
    ),
    mk(
      2100,
      "ERROR",
      "com.example.payment.StripeGateway",
      "http-nio-8080-exec-2",
      "Payment authorization failed: card_declined",
      {
        mdc: { traceId: "a1b2c3d4", spanId: "12", orderId: "o-42" },
        stackTrace:
          "com.example.payment.PaymentException: card_declined\n" +
          "\tat com.example.payment.StripeGateway.authorize(StripeGateway.java:142)\n" +
          "\tat com.example.checkout.CheckoutService.pay(CheckoutService.java:88)\n" +
          "\tat com.example.web.OrderController.checkout(OrderController.java:53)\n" +
          "\tat sun.reflect.NativeMethodAccessorImpl.invoke(Native Method)",
      },
    ),
    mk(
      2700,
      "INFO",
      "com.example.metrics.Reporter",
      "scheduled-1",
      "Reported 142 metrics to backend",
    ),
    mk(
      3300,
      "DEBUG",
      "com.example.db.HikariCP",
      "db-1",
      "Acquired connection from pool (active=4, idle=6)",
    ),
    mk(
      3900,
      "INFO",
      "com.example.web.RequestLogger",
      "http-nio-8080-exec-3",
      "POST /api/orders 201 in 142ms",
      { mdc: { traceId: "f9e8d7c6", spanId: "21" } },
    ),
    mk(
      4400,
      "WARN",
      "com.example.security.RateLimiter",
      "http-nio-8080-exec-4",
      "Client 198.51.100.7 exceeded threshold (60 req/min)",
    ),
    mk(
      5000,
      "ERROR",
      "com.example.db.OrderRepository",
      "db-2",
      "Slow query detected (1240 ms): SELECT * FROM orders WHERE …",
      {
        stackTrace:
          "java.sql.SQLTimeoutException: Query exceeded threshold\n" +
          "\tat com.zaxxer.hikari.pool.ProxyStatement.executeQuery(ProxyStatement.java:111)\n" +
          "\tat com.example.db.OrderRepository.findAll(OrderRepository.java:67)",
      },
    ),
    mk(
      5600,
      "INFO",
      "com.example.scheduler.Cleanup",
      "scheduled-2",
      "Removed 27 stale sessions",
    ),
    mk(
      6200,
      "INFO",
      "com.example.App",
      "main",
      "Startup completed in 6.2 seconds",
    ),
    mk(
      6800,
      "TRACE",
      "com.example.internal.Heartbeat",
      "heartbeat-1",
      "tick #1 (uptime=6800ms)",
    ),
  ];
}

/**
 * A ready-to-paste Logback configuration snippet that streams logs
 * to Lumberjack via TCP (default port 9999).
 */
export const LOGBACK_TCP_SNIPPET = `<!-- Lumberjack TCP appender — paste into your logback-spring.xml -->
<configuration>
  <appender name="LUMBERJACK" class="ch.qos.logback.classic.net.SocketAppender">
    <remoteHost>127.0.0.1</remoteHost>
    <port>9999</port>
    <reconnectionDelay>5 seconds</reconnectionDelay>
    <includeCallerData>false</includeCallerData>
  </appender>

  <!-- Optional JSON encoder via logstash-logback-encoder for richer MDC support -->
  <!--
  <appender name="LUMBERJACK_JSON" class="net.logstash.logback.appender.LogstashTcpSocketAppender">
    <destination>127.0.0.1:9999</destination>
    <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
  </appender>
  -->

  <root level="INFO">
    <appender-ref ref="LUMBERJACK"/>
  </root>
</configuration>`;
