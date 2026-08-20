// Simulates a cross-service trace (Go order-service -> PHP payment-service
// -> Node notification-service) and POSTs it to the running backend.
// Run: npm run mock-trace
import type { TracePayload } from "../types.js";

const API = process.env.API_URL || "http://localhost:4000";

const trace: TracePayload = {
  traceId: `trace-${Date.now()}`,
  steps: [
    {
      service: "order-service",
      file: "order-service.go",
      function: "CreateOrder",
      line: 4,
      inputs: { userID: "u_123", items: ["sku_1", "sku_2"] },
      locals: {},
      timestamp: Date.now(),
    },
    {
      service: "order-service",
      file: "order-service.go",
      function: "calculateTotal",
      line: 15,
      inputs: { items: ["sku_1", "sku_2"] },
      locals: { total: 2000 },
      timestamp: Date.now() + 1,
    },
    {
      service: "order-service",
      file: "order-service.go",
      function: "CreateOrder",
      line: 7,
      inputs: { userID: "u_123", total: 2000 },
      locals: {},
      timestamp: Date.now() + 2,
    },
    {
      service: "payment-service",
      file: "payment-service.php",
      function: "chargePayment",
      line: 5,
      inputs: { userId: "u_123", amount: 2000 },
      locals: {},
      timestamp: Date.now() + 3,
    },
    {
      service: "payment-service",
      file: "payment-service.php",
      function: "processCharge",
      line: 10,
      inputs: { amount: 2000 },
      locals: { account: { balance: 5000 } },
      timestamp: Date.now() + 4,
    },
    {
      service: "notification-service",
      file: "notification-service.js",
      function: "sendReceipt",
      line: 2,
      inputs: { orderId: "ord_789", userId: "u_123" },
      locals: {},
      timestamp: Date.now() + 5,
    },
    {
      service: "notification-service",
      file: "notification-service.js",
      function: "buildPayload",
      line: 7,
      inputs: { orderId: "ord_789", userId: "u_123" },
      locals: { payload: { channel: "email" } },
      timestamp: Date.now() + 6,
    },
  ],
};

const res = await fetch(`${API}/api/traces`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(trace),
});
console.log(res.status, await res.json());
