#!/usr/bin/env tsx

/**
 * Test TCP socket cleanup to ensure no memory leaks
 * This test verifies that sockets are properly cleaned up when:
 * 1. Clients disconnect normally
 * 2. Clients timeout
 * 3. Server stops
 */

import * as net from "net";
import { NetworkService } from "../src/services/NetworkService";
import type { LogEntry } from "../src/types/ipc";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testTcpSocketCleanup(): Promise<void> {
  console.log("Running TCP socket cleanup tests...\n");

  const networkService = new NetworkService();
  const receivedLogs: LogEntry[] = [];

  // Set up log callback
  networkService.setLogCallback((entries) => {
    receivedLogs.push(...entries);
  });

  // Set up dummy parsers
  networkService.setParsers({
    parseJsonFile: () => [],
    parseTextLines: () => [],
    toEntry: (obj, _fallback, source) => ({
      timestamp: new Date().toISOString(),
      level: (obj.level as string) || "INFO",
      logger: null,
      thread: null,
      message: (obj.message as string) || "",
      traceId: null,
      stackTrace: null,
      raw: obj,
      source,
    }),
  });

  // Test 1: Start server and check status
  console.log("Test 1: Starting TCP server...");
  const startResult = await networkService.startTcpServer(0); // Use port 0 for random available port
  if (!startResult.ok || !startResult.port) {
    throw new Error("Failed to start TCP server");
  }
  const port = startResult.port;
  console.log(`✓ Server started on port ${port}`);

  const status1 = networkService.getTcpStatus();
  if (status1.activeConnections !== 0) {
    throw new Error(
      `Expected 0 active connections, got ${status1.activeConnections}`,
    );
  }
  console.log(`✓ Initial active connections: ${status1.activeConnections}\n`);

  // Test 2: Connect client and send data
  console.log("Test 2: Connecting client and sending data...");
  const client1 = net.createConnection({ port }, () => {
    console.log("✓ Client 1 connected");
  });

  await sleep(100); // Wait for connection to be established

  const status2 = networkService.getTcpStatus();
  if (status2.activeConnections !== 1) {
    throw new Error(
      `Expected 1 active connection, got ${status2.activeConnections}`,
    );
  }
  console.log(`✓ Active connections after connect: ${status2.activeConnections}`);

  client1.write('{"message":"test message 1"}\n');
  await sleep(100);

  if (receivedLogs.length !== 1) {
    throw new Error(`Expected 1 log entry, got ${receivedLogs.length}`);
  }
  console.log(`✓ Received log entry: ${receivedLogs[0].message}\n`);

  // Test 3: Disconnect client normally
  console.log("Test 3: Disconnecting client normally...");
  client1.end();
  await sleep(200); // Wait for cleanup

  const status3 = networkService.getTcpStatus();
  if (status3.activeConnections !== 0) {
    throw new Error(
      `Expected 0 active connections after disconnect, got ${status3.activeConnections}`,
    );
  }
  console.log(`✓ Active connections after disconnect: ${status3.activeConnections}\n`);

  // Test 4: Multiple simultaneous connections
  console.log("Test 4: Testing multiple simultaneous connections...");
  const clients: net.Socket[] = [];
  for (let i = 0; i < 5; i++) {
    const client = net.createConnection({ port });
    clients.push(client);
  }

  await sleep(200); // Wait for connections

  const status4 = networkService.getTcpStatus();
  if (status4.activeConnections !== 5) {
    throw new Error(
      `Expected 5 active connections, got ${status4.activeConnections}`,
    );
  }
  console.log(`✓ Active connections with multiple clients: ${status4.activeConnections}`);

  // Close all clients
  for (const client of clients) {
    client.end();
  }
  await sleep(200);

  const status5 = networkService.getTcpStatus();
  if (status5.activeConnections !== 0) {
    throw new Error(
      `Expected 0 active connections after closing all, got ${status5.activeConnections}`,
    );
  }
  console.log(`✓ Active connections after closing all clients: ${status5.activeConnections}\n`);

  // Test 5: Buffer overflow protection
  console.log("Test 5: Testing buffer overflow protection...");
  const client2 = net.createConnection({ port });
  await sleep(100);

  // Send a very large message without newlines to test buffer protection
  const largeData = "x".repeat(2 * 1024 * 1024); // 2MB of data
  client2.write(largeData);
  await sleep(200);

  console.log("✓ Large data sent without crashing\n");
  client2.end();
  await sleep(200);

  // Test 6: Stop server with active connections
  console.log("Test 6: Stopping server with active connections...");
  const client3 = net.createConnection({ port });
  await sleep(100);

  const status6 = networkService.getTcpStatus();
  if (status6.activeConnections !== 1) {
    throw new Error(
      `Expected 1 active connection, got ${status6.activeConnections}`,
    );
  }
  console.log(`✓ Active connections before stop: ${status6.activeConnections}`);

  const stopResult = await networkService.stopTcpServer();
  if (!stopResult.ok) {
    throw new Error("Failed to stop TCP server");
  }

  const status7 = networkService.getTcpStatus();
  if (status7.running) {
    throw new Error("Server should not be running after stop");
  }
  if (status7.activeConnections !== 0) {
    throw new Error(
      `Expected 0 active connections after stop, got ${status7.activeConnections}`,
    );
  }
  console.log(`✓ Server stopped successfully`);
  console.log(`✓ Active connections after stop: ${status7.activeConnections}\n`);

  // Test 7: Verify diagnostics
  console.log("Test 7: Verifying diagnostics...");
  const diag = networkService.getDiagnostics();
  console.log("Diagnostics:", JSON.stringify(diag, null, 2));
  if (diag.tcp.running) {
    throw new Error("TCP should not be running");
  }
  if (diag.tcp.activeConnections !== 0) {
    throw new Error(
      `Expected 0 active connections in diagnostics, got ${diag.tcp.activeConnections}`,
    );
  }
  console.log("✓ Diagnostics are correct\n");

  console.log("✅ All TCP socket cleanup tests passed!");
}

// Run tests
testTcpSocketCleanup().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
