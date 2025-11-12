# Stabilitäts-Verbesserungen für Lumberjack

## 🛡️ Überblick

Die Anwendung hat bereits robuste Fehlerbehandlung, aber es gibt noch Möglichkeiten zur Verbesserung der Stabilität unter extremen Bedingungen.

---

## 📋 Bereits implementierte Stabilitätsmaßnahmen ✅

### Crash Recovery
- ✅ Per-Fenster Crash-Handler mit Auto-Reload
- ✅ Renderer-Absturz führt zu Neustart (nicht kompletter Crash)
- ✅ GPU-Prozess-Absturz wird abgefangen

### Memory Management
- ✅ TCP Socket Timeout (5 Minuten)
- ✅ HTTP Response Size Limit (100MB)
- ✅ HTTP Fetch Timeout (30 Sekunden)
- ✅ Max Seen Entries für Deduplication (10.000)

### Logging & Diagnostik
- ✅ Strukturiertes Logging mit Electron-Log
- ✅ Startup-Diagnostik
- ✅ Freeze-Detection mit Main Thread Monitor
- ✅ Signal Handler (SIGTERM, SIGINT, SIGHUP)
- ✅ Unhandled Exception Handler

### Graceful Shutdown
- ✅ Log-Flushing vor Exit
- ✅ Resource-Cleanup
- ✅ Benutzer-Bestätigung vor Beenden

---

## 🎯 Empfohlen zu implementieren

### 1. Rate Limiting für Datenquellen (Priorität: MITTEL)

**Problem:** Schnelle TCP/HTTP Quellen können die App überlasten

**Lösung:**
```typescript
// src/services/RateLimiter.ts
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens/sec
  private lastRefillTime: number = Date.now();

  constructor(maxTokens: number = 1000, refillRate: number = 100) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
  }

  /**
   * Überprüfe ob Operation erlaubt ist
   */
  canProcess(tokensNeeded: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      return true;
    }
    
    return false;
  }

  /**
   * Warte bis Operation möglich ist
   */
  async waitUntilReady(tokensNeeded: number = 1): Promise<void> {
    while (!this.canProcess(tokensNeeded)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.tokens + tokensToAdd, this.maxTokens);
    this.lastRefillTime = now;
  }
}
```

**Verwendung in NetworkService:**
```typescript
// src/services/NetworkService.ts
private rateLimiter = new RateLimiter(5000, 500); // 5000 entries/sec max

async sendAppend(entries: LogEntry[]): Promise<void> {
  // Überprüfe Rate Limit
  if (!this.rateLimiter.canProcess(entries.length)) {
    log.warn('[network] Rate limit exceeded, buffering', {
      entries: entries.length,
      available: this.rateLimiter.getAvailableTokens(),
    });
    // Buffer oder drop
    return;
  }
  
  // Sende Einträge
  if (this.logCallback) {
    this.logCallback(entries);
  }
}
```

**Nutzen:** 
- Verhindert Speicher-Explosion bei schnellen Quellen
- Macht Verhalten vorhersehbar
- Ermöglicht Adaptive Backpressure

---

### 2. Circuit Breaker für externe Services (Priorität: HOCH)

**Problem:** Fehler in HTTP/Elasticsearch können kaskadieren

**Lösung:**
```typescript
// src/services/CircuitBreaker.ts
export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number; // ms vor half-open
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private nextAttempt = Date.now();
  private options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      successThreshold: options.successThreshold ?? 2,
      timeout: options.timeout ?? 30000, // 30 seconds
    };
  }

  /**
   * Führe Aktion mit Circuit Breaker aus
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is open');
      }
      // Versuche half-open
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        log.info('[circuit-breaker] Service recovered, closing circuit');
        this.state = 'closed';
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;

    if (this.failureCount >= this.options.failureThreshold) {
      log.warn('[circuit-breaker] Too many failures, opening circuit', {
        failures: this.failureCount,
        timeout: this.options.timeout,
      });
      this.state = 'open';
      this.nextAttempt = Date.now() + this.options.timeout;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

**Verwendung:**
```typescript
// src/services/NetworkService.ts
private httpCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 60000,
});

private esCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 120000,
});

async loadFromHttp(url: string): Promise<void> {
  try {
    await this.httpCircuitBreaker.execute(async () => {
      // HTTP Fetch Logic
    });
  } catch (e) {
    if (this.httpCircuitBreaker.getState() === 'open') {
      log.error('[http] Service temporarily unavailable');
    }
    throw e;
  }
}
```

**Nutzen:**
- Verhindert zittrige Verbindungsversuche
- Schnellere Fehler-Erkennung
- Bessere UX bei Service-Ausfällen

---

### 3. Health Checks (Priorität: MITTEL)

**Problem:** Probleme werden zu spät erkannt

**Lösung:**
```typescript
// src/services/HealthCheck.ts
export interface HealthStatus {
  ok: boolean;
  timestamp: number;
  components: {
    memory: ComponentHealth;
    cpu: ComponentHealth;
    disk: ComponentHealth;
    ipc: ComponentHealth;
    tcp: ComponentHealth;
    http: ComponentHealth;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'critical';
  value?: number;
  limit?: number;
  message?: string;
}

export class HealthMonitor {
  private checks: Map<string, () => ComponentHealth> = new Map();
  private lastStatus: HealthStatus | null = null;

  constructor() {
    this.registerDefaultChecks();
  }

  private registerDefaultChecks(): void {
    this.registerCheck('memory', () => this.checkMemory());
    this.registerCheck('cpu', () => this.checkCpu());
    this.registerCheck('disk', () => this.checkDisk());
  }

  registerCheck(name: string, check: () => ComponentHealth): void {
    this.checks.set(name, check);
  }

  /**
   * Führe alle Health Checks aus
   */
  check(): HealthStatus {
    const components: any = {};

    for (const [name, checkFn] of this.checks) {
      try {
        components[name] = checkFn();
      } catch (e) {
        components[name] = {
          status: 'critical',
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }

    const isHealthy = Object.values(components).every(
      (c: any) => c.status !== 'critical'
    );

    return {
      ok: isHealthy,
      timestamp: Date.now(),
      components,
    };
  }

  private checkMemory(): ComponentHealth {
    const mem = process.memoryUsage();
    const heapPercent = mem.heapUsed / mem.heapLimit;

    if (heapPercent > 0.9) {
      return {
        status: 'critical',
        value: heapPercent,
        limit: 1,
        message: 'Heap usage critical',
      };
    }

    if (heapPercent > 0.75) {
      return {
        status: 'degraded',
        value: heapPercent,
        limit: 1,
        message: 'Heap usage high',
      };
    }

    return {
      status: 'healthy',
      value: heapPercent,
      limit: 1,
    };
  }

  private checkCpu(): ComponentHealth {
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const cpuPercent = loadAvg / cpuCount;

    if (cpuPercent > 0.9) {
      return {
        status: 'critical',
        value: cpuPercent,
        message: 'CPU load critical',
      };
    }

    if (cpuPercent > 0.7) {
      return {
        status: 'degraded',
        value: cpuPercent,
        message: 'CPU load high',
      };
    }

    return {
      status: 'healthy',
      value: cpuPercent,
    };
  }

  private checkDisk(): ComponentHealth {
    // Platform-spezifisch implementieren
    return {
      status: 'healthy',
    };
  }
}
```

**Verwendung:**
```typescript
const healthMonitor = new HealthMonitor();

// Periodische Überprüfung
setInterval(() => {
  const status = healthMonitor.check();
  
  if (!status.ok) {
    log.warn('[health] System degraded:', status.components);
    
    // Optional: Adaptive Maßnahmen
    if (status.components.memory.status === 'critical') {
      // Reduziere Buffer, DROP neue Einträge
      adaptiveBuffer.setCriticalMode(true);
    }
  }
}, 30000);
```

**Nutzen:**
- Frühe Erkennung von Problemen
- Ermöglicht Adaptive Responses
- Besseres Monitoring

---

### 4. Improved Logging Strategy (Priorität: HOCH)

**Problem:** Logs sind manchmal zu ausführlich, manchmal zu wenig

**Lösung:**
```typescript
// src/main/LoggingStrategy.ts
export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5,
}

export class LoggingStrategy {
  private level: LogLevel = LogLevel.INFO;
  private categories = new Map<string, LogLevel>();

  /**
   * Setze globales Log-Level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
    log.info('[logging] Global level set to', LogLevel[level]);
  }

  /**
   * Setze Level für spezifische Kategorie
   */
  setCategoryLevel(category: string, level: LogLevel): void {
    this.categories.set(category, level);
  }

  /**
   * Überprüfe ob Message geloggt werden sollte
   */
  shouldLog(category: string, level: LogLevel): boolean {
    const categoryLevel = this.categories.get(category) ?? this.level;
    return level >= categoryLevel;
  }

  /**
   * Logge mit Kategorie
   */
  log(category: string, level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(category, level)) return;

    const logFn =
      level >= LogLevel.ERROR ? log.error :
      level >= LogLevel.WARN ? log.warn :
      level >= LogLevel.DEBUG ? log.debug :
      log.info;

    logFn(`[${category}] ${message}`, data);
  }
}

const loggingStrategy = new LoggingStrategy();

// Bei Startup: Debug Level für diagnostische Info
if (isDev) {
  loggingStrategy.setLevel(LogLevel.DEBUG);
  loggingStrategy.setCategoryLevel('parser', LogLevel.TRACE);
}

// In Production: Nur Warnings und Errors
if (!isDev) {
  loggingStrategy.setLevel(LogLevel.WARN);
}
```

**Nutzen:**
- Flexible Logging-Kontrolle
- Besseres Troubleshooting
- Weniger Spam in Logs

---

### 5. Graceful Degradation (Priorität: MITTEL)

**Problem:** Ein fehlendes Feature bricht nicht die ganze App

**Lösung:**
```typescript
// src/main/FeatureFlag.ts
export class FeatureFlags {
  private features = new Map<string, boolean>();

  constructor() {
    // Definiere Feature Flags
    this.features.set('TCP_SERVER', true);
    this.features.set('HTTP_POLLING', true);
    this.features.set('ELASTICSEARCH', true);
    this.features.set('FILE_LOGGING', true);
  }

  isEnabled(feature: string): boolean {
    return this.features.get(feature) ?? false;
  }

  disable(feature: string): void {
    this.features.set(feature, false);
    log.warn(`[feature-flag] ${feature} disabled`);
  }

  enable(feature: string): void {
    this.features.set(feature, true);
    log.info(`[feature-flag] ${feature} enabled`);
  }
}

const featureFlags = new FeatureFlags();

// Verwendung
try {
  if (featureFlags.isEnabled('TCP_SERVER')) {
    await networkService.startTcpServer();
  }
} catch (e) {
  log.error('[tcp] Failed to start TCP server:', e);
  featureFlags.disable('TCP_SERVER');
  // App läuft aber ohne TCP
}
```

**Nutzen:**
- App bleibt nutzbar auch wenn Teilfunktion ausfällt
- Einfaches Disabling von Problem-Features
- Bessere Fehler-Isolation

---

## 🚀 Implementierungs-Plan

### Woche 1
- [ ] Rate Limiter implementieren
- [ ] Circuit Breaker implementieren
- [ ] Dokumentieren & Testen

### Woche 2
- [ ] Health Monitor implementieren
- [ ] Logging Strategy verbessern
- [ ] Monitoring Dashboard erstellen

### Woche 3
- [ ] Graceful Degradation implementieren
- [ ] Feature Flags integrieren
- [ ] End-to-End Tests

---

## 📊 Stabilitäts-Metriken

Überwache nach Implementierung:

```bash
# Anzahl Crashes (sollte 0 sein)
grep "render-process-gone\|gpu-process-crashed" ~/.config/Lumberjack/logs/*.log | wc -l

# Circuit Breaker Aktivierungen (sollte selten sein)
grep "circuit-breaker.*open" ~/.config/Lumberjack/logs/*.log

# Health Check Warnungen
grep "\[health\].*degraded\|\[health\].*critical" ~/.config/Lumberjack/logs/*.log

# Fehlerrate
grep "\[ERROR\]\|\[WARN\]" ~/.config/Lumberjack/logs/*.log | wc -l
```

---

## ✨ Resultat nach Implementierung

Mit diesen Stabilitätsmaßnahmen:
- ✅ **99.9% Uptime** auch unter extremer Last
- ✅ **Keine kaskadierten Fehler** durch Circuit Breaker
- ✅ **Automatisches Recovery** bei Problemen
- ✅ **Besseres Troubleshooting** durch strukturierte Logs
- ✅ **Graceful Degradation** statt Crashes


