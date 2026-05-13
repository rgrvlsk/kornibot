import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

class SqliteD1PreparedStatement {
  private params: unknown[] = [];

  public constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}

  public bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  public async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
    const result = this.db.prepare(this.sql).run(...this.params);

    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  public async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as T | undefined;
    return row ?? null;
  }

  public async all<T>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows };
  }
}

export class SqliteD1Database {
  public readonly sqlite = new DatabaseSync(":memory:");

  public constructor() {
    const migrationsDir = resolve(process.cwd(), "migrations");
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      this.sqlite.exec(readFileSync(join(migrationsDir, file), "utf8"));
    }
  }

  public prepare(sql: string): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(this.sqlite, sql);
  }

  public close(): void {
    this.sqlite.close();
  }
}

export class FakeR2Bucket {
  public readonly objects = new Map<string, { body: BodyInit; contentType?: string }>();
  public readonly puts: Array<{ key: string; body: string; httpMetadata?: R2HTTPMetadata }> = [];
  public readonly deletedKeys: string[] = [];
  public readonly deletes = this.deletedKeys;

  public async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: R2PutOptions,
  ): Promise<void> {
    const body = readR2Body(value);
    if (body instanceof Promise) {
      const resolvedBody = await body;
      this.recordPut(key, value, resolvedBody, options);
      return;
    }

    this.recordPut(key, value, body, options);
  }

  public async get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }

    return {
      body: object.body,
      httpMetadata: {
        contentType: object.contentType,
      },
    };
  }

  public async delete(key: string): Promise<void> {
    this.deletedKeys.push(key);
  }

  private recordPut(
    key: string,
    _value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    body: string,
    options?: R2PutOptions,
  ): void {
    this.objects.set(key, {
      body,
      contentType: options?.httpMetadata?.contentType,
    });
    this.puts.push({ key, body, httpMetadata: options?.httpMetadata });
  }
}

export function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {
      return undefined;
    },
    passThroughOnException() {
      return undefined;
    },
  };
}

export function createExecutionContextWithWaits(): ExecutionContext & { waits: Promise<unknown>[] } {
  const waits: Promise<unknown>[] = [];

  return {
    waits,
    waitUntil(promise: Promise<unknown>) {
      waits.push(promise);
    },
    passThroughOnException() {
      return undefined;
    },
  };
}

export function closeD1Databases(contexts: SqliteD1Database[]): void {
  while (contexts.length > 0) {
    contexts.pop()?.close();
  }
}

function readR2Body(value: ReadableStream | ArrayBuffer | ArrayBufferView | string): string | Promise<string> {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(value);
  }

  if (value instanceof ReadableStream) {
    return readReadableStream(value);
  }

  throw new Error("unsupported R2 test body");
}

async function readReadableStream(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  for (;;) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    chunks.push(result.value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(merged);
}
