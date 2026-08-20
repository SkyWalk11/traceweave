// payment-service — run with: tsx examples/two-services/service-b.ts
// Called by service-a; continues the same trace via the TRACE_HEADER.
import http from "node:http";
import { continueTrace, recordStep, endTrace, TRACE_HEADER } from "../../dist/index.js";

function charge(userId: string, amount: number) {
  const account = { balance: 5000 };
  recordStep({
    service: "payment-service",
    file: "examples/two-services/service-b.ts",
    function: "charge",
    line: 7,
    inputs: { userId, amount },
    locals: { account },
  });

  const approved = account.balance >= amount;
  recordStep({
    service: "payment-service",
    file: "examples/two-services/service-b.ts",
    function: "charge",
    line: 16,
    locals: { approved, remaining: account.balance - amount },
  });

  return { approved, remaining: account.balance - amount };
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/charge") return res.writeHead(404).end();

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { userId, amount } = JSON.parse(body);
      const traceId = req.headers[TRACE_HEADER] as string | undefined;

      const run = (fn: () => void) => (traceId ? continueTrace(traceId, fn) : fn());
      run(async () => {
        const result = charge(userId, amount);
        await endTrace({ apiUrl: process.env.TTD_API_URL });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      });
    });
  })
  .listen(5002, () => console.log("payment-service listening on :5002"));
