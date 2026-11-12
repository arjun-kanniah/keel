// Next.js calls register() once per server start. Traces are always written to Postgres (the
// trace viewer reads those); when OTEL_EXPORTER_OTLP_ENDPOINT is set, the same spans are also
// exported over OTLP/HTTP to any OpenTelemetry backend (Honeycomb, Grafana, Datadog, Jaeger...).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const { NodeTracerProvider, BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const provider = new NodeTracerProvider({ spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())] });
  provider.register();
}
