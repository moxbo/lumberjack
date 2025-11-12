# 🔍 MONITORING & TESTING GUIDE
## Performance & Stability Verification für Lumberjack

---

## 📊 Monitoring Setup

### 1. Performance Dashboard (Terminal-basiert)

**Datei:** `scripts/monitor-performance.sh`

```bash
#!/bin/bash
# Real-time Performance Monitoring für Lumberjack

echo "🔍 Lumberjack Performance Monitor"
echo "=================================="

# Find Electron process
PID=$(pgrep -f "Electron.*Lumberjack" | head -1)

if [ -z "$PID" ]; then
    echo "❌ Lumberjack nicht gefunden. Bitte App starten."
    exit 1
fi

echo "📍 Process ID: $PID"
echo ""
echo "Live Monitoring (drücke Ctrl+C zum Beenden):"
echo ""

# Header
printf "%-10s %-12s %-12s %-12s %-10s\n" "TIME" "MEMORY" "CPU%" "THREADS" "FDS"
printf "%-10s %-12s %-12s %-12s %-10s\n" "----" "------" "----" "-------" "---"

# Monitoring Loop
while true; do
    TIMESTAMP=$(date "+%H:%M:%S")
    
    # Memory in MB
    MEMORY=$(ps -p $PID -o rss= | awk '{print int($1/1024)"MB"}')
    
    # CPU Percentage
    CPU=$(ps -p $PID -o %cpu= | awk '{print $1"%"}')
    
    # Thread count
    THREADS=$(ps -p $PID -L | wc -l)
    THREADS=$((THREADS - 1))  # Subtract header
    
    # Open file descriptors
    FDS=$(lsof -p $PID 2>/dev/null | wc -l)
    FDS=$((FDS - 1))  # Subtract header
    
    printf "%-10s %-12s %-12s %-12s %-10s\n" "$TIMESTAMP" "$MEMORY" "$CPU" "$THREADS" "$FDS"
    
    sleep 2
done
```

**Verwendung:**
```bash
chmod +x scripts/monitor-performance.sh
./scripts/monitor-performance.sh
```

---

### 2. Memory Leak Detection

**Datei:** `scripts/detect-memory-leaks.ts`

```typescript
/**
 * Memory Leak Detection Script
 * Überwacht Speichernutzung über Zeit
 */

import log from 'electron-log/main';
import os from 'os';

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

export class MemoryLeakDetector {
  private snapshots: MemorySnapshot[] = [];
  private threshold = 50 * 1024 * 1024; // 50MB Änderung
  private windowSize = 5; // Check every 5 snapshots

  /**
   * Nehme Speicher-Snapshot
   */
  snapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const snap: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
    };

    this.snapshots.push(snap);

    // Halte nur letzte 100 Snapshots
    if (this.snapshots.length > 100) {
      this.snapshots.shift();
    }

    return snap;
  }

  /**
   * Analysiere auf Memory Leaks
   */
  analyze(): {
    hasLeak: boolean;
    growthRate: number;
    message: string;
  } {
    if (this.snapshots.length < this.windowSize) {
      return {
        hasLeak: false,
        growthRate: 0,
        message: 'Nicht genug Daten zum Analysieren',
      };
    }

    const recent = this.snapshots.slice(-this.windowSize);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];

    const timeDiff = newest.timestamp - oldest.timestamp;
    const heapDiff = newest.heapUsed - oldest.heapUsed;
    const growthRate = heapDiff / (timeDiff / 1000); // Bytes per second

    const hasLeak = heapDiff > this.threshold && growthRate > 1024 * 1024; // 1MB/sec

    let message = '✅ Kein Speicherleck erkannt';
    if (hasLeak) {
      message = `⚠️  Mögliches Speicherleck! Growth: ${(growthRate / 1024 / 1024).toFixed(2)}MB/sec`;
    }

    return { hasLeak, growthRate, message };
  }

  /**
   * Starte periodische Überwachung
   */
  startMonitoring(intervalMs = 30000): NodeJS.Timeout {
    return setInterval(() => {
      const snap = this.snapshot();
      const analysis = this.analyze();

      const memMB = snap.heapUsed / 1024 / 1024;
      log.info('[memory-leak-detector]', {
        heapMB: memMB.toFixed(1),
        ...analysis,
      });

      if (analysis.hasLeak) {
        log.error('[memory-leak-detector] POTENTIAL LEAK DETECTED', {
          growthRateMBps: (analysis.growthRate / 1024 / 1024).toFixed(2),
          currentHeapMB: memMB.toFixed(1),
        });
      }
    }, intervalMs);
  }
}

// Export für Integration
export const detector = new MemoryLeakDetector();
```

**Integration in main.ts:**
```typescript
import { detector } from './MemoryLeakDetector';

// Start monitoring on app ready
app.whenReady().then(() => {
  if (!isDev || process.env.MEMORY_DEBUG === '1') {
    detector.startMonitoring(30000); // Check alle 30 Sekunden
  }
});
```

---

## 🧪 Benchmark Tests

### 1. Parsing Performance Test

**Datei:** `scripts/benchmark-parsing.ts`

```typescript
/**
 * Benchmark für Log-Parsing Performance
 */

import * as fs from 'fs';
import * as path from 'path';
import { getParsers } from '../src/main/main';

async function generateTestData(sizeKB: number): Promise<string> {
  const lines: string[] = [];
  const targetBytes = sizeKB * 1024;
  let currentBytes = 0;

  while (currentBytes < targetBytes) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: ['INFO', 'WARN', 'ERROR'][Math.floor(Math.random() * 3)],
      message: `Test log entry ${Math.random()}`,
      thread: `thread-${Math.floor(Math.random() * 10)}`,
      logger: 'com.example.TestLogger',
    });

    lines.push(line);
    currentBytes += line.length + 1; // +1 for newline
  }

  return lines.join('\n');
}

async function benchmarkParsing() {
  console.log('🚀 Parsing Performance Benchmark\n');

  const testSizes = [100, 500, 1000, 5000]; // KB
  const parsers = getParsers();

  for (const sizeKB of testSizes) {
    console.log(`\n📊 Testing ${sizeKB}KB JSON data:`);

    const data = await generateTestData(sizeKB);

    // Warm up
    parsers.parseJsonFile('test', data);

    // Benchmark
    const start = Date.now();
    const result = parsers.parseJsonFile('test', data);
    const duration = Date.now() - start;

    const entriesPerSec = Math.round((result.length / duration) * 1000);
    const mbPerSec = ((sizeKB / 1024) / (duration / 1000)).toFixed(2);

    console.log(`  ⏱️  Duration: ${duration}ms`);
    console.log(`  📈 Entries: ${result.length}`);
    console.log(`  ⚡ Speed: ${entriesPerSec} entries/sec`);
    console.log(`  🚀 Throughput: ${mbPerSec} MB/sec`);
  }
}

benchmarkParsing().catch(console.error);
```

**Verwendung:**
```bash
npm run build:main
npx tsx scripts/benchmark-parsing.ts
```

---

### 2. Memory Benchmark

**Datei:** `scripts/benchmark-memory.ts`

```typescript
/**
 * Memory Usage Benchmark
 * Simuliert verschiedene Szenarien
 */

import { AdaptiveBuffer } from '../src/main/AdaptiveBuffer';

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function logMemory(label: string): void {
  const mem = process.memoryUsage();
  console.log(`  ${label}: ${formatMB(mem.heapUsed)}MB heap`);
}

async function benchmarkBuffer() {
  console.log('🧠 Memory Benchmark\n');

  const buffer = new AdaptiveBuffer(10000);

  // Test 1: Schnelle Einfügungen
  console.log('Test 1: Fast insertions');
  logMemory('Start');

  const entries = Array(10000)
    .fill(null)
    .map((_, i) => ({
      timestamp: Date.now() + i,
      level: 'INFO',
      message: `Test message ${i}`,
    }));

  buffer.add(entries);
  logMemory('Nach 10k Einträge');

  buffer.flush();
  logMemory('Nach Flush');

  // Test 2: Speicher unter Backpressure
  console.log('\nTest 2: Backpressure');
  logMemory('Start');

  for (let i = 0; i < 100; i++) {
    const batch = Array(1000)
      .fill(null)
      .map(() => ({
        timestamp: Date.now(),
        level: 'INFO',
        message: `Batch ${i}`,
      }));

    if (!buffer.add(batch)) {
      console.log(`  Backpressure triggered at iteration ${i}`);
    }
  }

  const stats = buffer.getStats();
  console.log(`  Final buffer size: ${stats.currentSize}/${stats.maxSize}`);
  logMemory('After batches');

  buffer.destroy();
}

benchmarkBuffer().catch(console.error);
```

---

## ✅ Test-Szenarien

### Scenario 1: Große Datei laden

```typescript
// scripts/test-large-file.ts
async function testLargeFileLoad() {
  console.log('📂 Testing large file load...\n');

  const testFile = '/tmp/test-50mb.log';

  // Generiere Test-Datei falls nicht vorhanden
  if (!fs.existsSync(testFile)) {
    console.log('  Generating 50MB test file...');
    const lines: string[] = [];
    let size = 0;
    while (size < 50 * 1024 * 1024) {
      const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `Test log line`,
        data: 'x'.repeat(100),
      });
      lines.push(line);
      size += line.length;
    }
    fs.writeFileSync(testFile, lines.join('\n'));
  }

  // Benchmark
  console.log('  Loading file...');
  const start = Date.now();
  const data = fs.readFileSync(testFile, 'utf-8');
  const parsed = getParsers().parseTextLines('test', data);
  const duration = Date.now() - start;

  console.log(`  ✅ Loaded ${parsed.length} entries in ${duration}ms`);
  console.log(`  ⚡ Speed: ${Math.round(parsed.length / (duration / 1000))} entries/sec`);
}
```

### Scenario 2: Schnelle TCP-Daten

```typescript
// scripts/test-tcp-load.ts
async function testTcpLoad() {
  console.log('📡 Testing TCP load...\n');

  const networkService = new NetworkService();
  let receivedCount = 0;

  networkService.setLogCallback((entries) => {
    receivedCount += entries.length;
  });

  // Starte TCP Server
  await networkService.startTcpServer(9999);

  // Simuliere schnelle Datenquelle
  console.log('  Sending 10k entries...');
  const client = net.connect(9999, 'localhost');

  const start = Date.now();
  for (let i = 0; i < 10000; i++) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: `TCP test ${i}`,
    });
    client.write(line + '\n');
  }
  client.end();

  // Warte bis alle empfangen
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const duration = Date.now() - start;

  console.log(`  ✅ Received ${receivedCount} entries in ${duration}ms`);
  console.log(`  ⚡ Speed: ${Math.round(receivedCount / (duration / 1000))} entries/sec`);

  await networkService.stopTcpServer();
}
```

### Scenario 3: Event Loop Health

```typescript
// scripts/test-event-loop-health.ts
async function testEventLoopHealth() {
  console.log('⏱️  Testing Event Loop Health...\n');

  const delays: number[] = [];
  let lastCheck = Date.now();

  const interval = setInterval(() => {
    const now = Date.now();
    const delay = now - lastCheck - 100; // Expected 100ms
    delays.push(Math.max(0, delay));
    lastCheck = now;
  }, 100);

  // Do some heavy work
  console.log('  Running heavy workload for 10 seconds...');
  const start = Date.now();
  while (Date.now() - start < 10000) {
    // CPU-intensive operation
    for (let i = 0; i < 1000000; i++) {
      Math.sqrt(i);
    }
  }

  clearInterval(interval);

  // Analyze delays
  const maxDelay = Math.max(...delays);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;

  console.log(`  Max delay: ${maxDelay}ms`);
  console.log(`  Avg delay: ${avgDelay.toFixed(1)}ms`);

  if (maxDelay > 100) {
    console.log(`  ⚠️  Event loop was blocked for ${maxDelay}ms`);
  } else {
    console.log(`  ✅ Event loop healthy`);
  }
}
```

---

## 📈 Performance Profiling

### Chrome DevTools Profiling

```typescript
// Aktiviere V8 Profiler in main.ts
import v8Profiler from 'v8-profiler-next';

if (process.env.PROFILE === '1') {
  const prof = v8Profiler.startProfiling('main', true);

  // ... App runs ...

  // Nach einiger Zeit:
  prof.stopProfiling().export((err, result) => {
    fs.writeFileSync('profile.cpuprofile', result);
    console.log('Profile saved to profile.cpuprofile');
  });

  // Öffne in Chrome DevTools:
  // DevTools → Performance → Load Profile
}
```

### Node.js Inspector

```bash
# Mit Inspector starten
node --inspect-brk dist-main/main.cjs

# In Chrome: chrome://inspect
# Klicke auf "inspect" neben der laufenden App
```

---

## 📋 Testing Checkliste

```
Performance Testing Checklist
=============================

Vor Optimierung:
□ Baseline Metriken erfassen
  □ Startup-Zeit
  □ Memory bei 10k/50k/100k Logs
  □ CPU unter verschiedenen Lasten
  □ Event Loop Lag

Nach jeder Phase:
□ Metriken neu messen
□ Verbesserung dokumentieren
□ Regression testen
  □ Scrolling smooth?
  □ Kein Memory Leak?
  □ Filter funktioniert?
  □ Search responsive?

Stabilitäts-Tests:
□ App 1h mit konstanten Logs laufen lassen
□ Memory sollte stabil sein (±50MB)
□ Keine Crashes
□ CPU sollte nicht über 70% gehen

Load Tests:
□ 50k Logs laden
□ 100k Logs laden
□ Schnelle TCP Feed (10k/sec)
□ Parallele HTTP Requests

Regression Tests:
□ Alte Features funktionieren noch
□ UI ist responsive
□ Filters sind schnell
□ Exports funktionieren
```

---

## 🎯 Success Criteria

**Quick Start erfolgreiche wenn:**
- ✅ Startup < 10s (statt 20s)
- ✅ Memory < 400MB bei 50k Logs
- ✅ Scroll FPS > 40
- ✅ Keine neuen Crashes

**Full Roadmap erfolgreich wenn:**
- ✅ Startup < 3-5s
- ✅ Memory < 150MB bei 50k Logs  
- ✅ Scroll FPS 60
- ✅ Event Loop Lag < 20ms
- ✅ 100k+ Logs möglich
- ✅ Crash Rate 0 pro Woche

---

## 📊 Metriken-Erfassung

**Datei:** `scripts/collect-metrics.ts`

```typescript
interface MetricsReport {
  timestamp: string;
  startup: number; // ms
  memoryPeak: number; // MB
  memoryAvg: number; // MB
  cpuAvg: number; // %
  eventLoopLag: number; // ms
  crashCount: number;
  uptime: number; // hours
}

function collectMetrics(): MetricsReport {
  const mem = process.memoryUsage();
  
  return {
    timestamp: new Date().toISOString(),
    startup: perfService.measure('startup', 'app-start', 'renderer-ready') || 0,
    memoryPeak: mem.heapTotal / 1024 / 1024,
    memoryAvg: mem.heapUsed / 1024 / 1024,
    cpuAvg: os.loadavg()[0] / os.cpus().length * 100,
    eventLoopLag: lastEventLoopLag,
    crashCount: crashCount,
    uptime: process.uptime() / 3600,
  };
}

// Speichere Metriken regelmäßig
setInterval(() => {
  const metrics = collectMetrics();
  fs.appendFileSync('metrics.jsonl', JSON.stringify(metrics) + '\n');
}, 60000);
```


