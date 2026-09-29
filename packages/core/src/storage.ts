/**
 * Minimal async key-value storage abstraction.
 *
 * The mobile app injects a React Native AsyncStorage-backed implementation;
 * tests use the in-memory one. This keeps all persistence local (private
 * student data stays on-device in this phase) and swappable.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** Typed JSON helper over a KeyValueStore. */
export class JsonStore {
  constructor(private readonly kv: KeyValueStore, private readonly prefix = "rojanda:") {}

  async read<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.kv.getItem(this.prefix + key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    await this.kv.setItem(this.prefix + key, JSON.stringify(value));
  }
}
