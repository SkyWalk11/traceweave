// order-service — run with: tsx examples/two-services/service-a.ts
// Then hit: curl localhost:5001/checkout
import http from "node:http";
import { startTrace, recordStep, endTrace, traceHeader } from "../../dist/index.js";

async function checkout(userId: string, items: string[]) {
  recordStep({
    service: "order-service",
    file: "examples/two-services/service-a.ts",
    function: "checkout",
    line: 8,
    inputs: { userId, items },
  });

  const total = items.length * 1000;
  recordStep({
    service: "order-service",
    file: "examples/two-services/service-a.ts",
    function: "checkout",
    line: 17,
    locals: { total },
  });

  const res = await fetch("http://localhost:5002/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...traceHeader() },
    body: JSON.stringify({ userId, amount: total }),
  });
  const charge = await res.json();

  recordStep({
    service: "order-service",
    file: "examples/two-services/service-a.ts",
    function: "checkout",
    line: 33,
    locals: { charge },
  });

  return { orderId: `ord_${Date.now()}`, total, charge };
}

http
  .createServer((req, res) => {
    if (req.url !== "/checkout") return res.writeHead(404).end();

    startTrace(async () => {
      const result = await checkout("u_123", ["sku_1", "sku_2"]);
      await endTrace();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
  })
  .listen(5001, () => console.log("order-service listening on :5001"));
