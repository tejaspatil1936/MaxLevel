import { EventEmitter } from "events";

export type SignalPayload = {
  type: "offer" | "answer" | "candidate" | "phone_state" | "status" | "preview";
  data: any;
  from: "laptop" | "phone" | "system";
  timestamp: number;
};

// Global singleton event emitter across API routes in Node.js
class ProctorSignalBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emitSignal(sessionId: string, payload: Omit<SignalPayload, "timestamp">) {
    const fullPayload: SignalPayload = {
      ...payload,
      timestamp: Date.now(),
    };
    this.emitter.emit(`session:${sessionId}`, fullPayload);
  }

  subscribe(sessionId: string, listener: (payload: SignalPayload) => void): () => void {
    const eventName = `session:${sessionId}`;
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }
}

// Global reference to survive module reloads in Next dev
const globalForSignal = globalThis as unknown as {
  proctorSignalBus?: ProctorSignalBus;
};

export const proctorSignalBus =
  globalForSignal.proctorSignalBus || new ProctorSignalBus();

if (process.env.NODE_ENV !== "production") {
  globalForSignal.proctorSignalBus = proctorSignalBus;
}
