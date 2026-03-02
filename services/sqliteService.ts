import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { AdminProfile, Student } from '../types';

const DB_STORAGE_KEY = 'insight_sqlite_db_v1';
const LEGACY_MIGRATION_KEY = 'legacy_migration_done_v1';

type QueryParam = string | number | null;

class SQLiteService {
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.SQL = await initSqlJs({ locateFile: () => wasmUrl });

      const persisted = this.loadPersistedDatabase();
      this.db = persisted ? new this.SQL.Database(persisted) : new this.SQL.Database();

      this.createSchema();
      this.importLegacyLocalStorageIfNeeded();
      this.persist();
    })();

    await this.initPromise;
  }

  async getAdmin(): Promise<AdminProfile | null> {
    await this.init();
    const rows = this.query<{
      name: string;
      face_description: string;
      recovery_secret: string;
      recovery_email: string | null;
      registered_at: string;
    }>(
      `SELECT name, face_description, recovery_secret, recovery_email, registered_at
       FROM admins WHERE id = 1 LIMIT 1`
    );

    if (rows.length === 0) return null;
    const admin = rows[0];
    return {
      name: admin.name,
      faceDescription: admin.face_description,
      recoverySecret: admin.recovery_secret,
      recoveryEmail: admin.recovery_email || undefined,
      registeredAt: admin.registered_at
    };
  }

  async upsertAdmin(admin: AdminProfile): Promise<void> {
    await this.init();
    this.execute(
      `INSERT INTO admins (id, name, face_description, recovery_secret, recovery_email, registered_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         face_description = excluded.face_description,
         recovery_secret = excluded.recovery_secret,
         recovery_email = excluded.recovery_email,
         registered_at = excluded.registered_at`,
      [
        admin.name.trim(),
        admin.faceDescription,
        admin.recoverySecret,
        admin.recoveryEmail ? admin.recoveryEmail.trim().toLowerCase() : null,
        admin.registeredAt
      ]
    );
    this.persist();
  }

  async deleteAdmin(): Promise<void> {
    await this.init();
    this.execute('DELETE FROM admins WHERE id = 1');
    this.persist();
  }

  async getStudents(): Promise<Student[]> {
    await this.init();
    const rows = this.query<{
      id: string;
      register_number: string;
      name: string;
      email: string;
      department: string;
      enrollment_year: number;
      status: 'Present' | 'Absent' | 'Late';
      face_description: string | null;
    }>(
      `SELECT id, register_number, name, email, department, enrollment_year, status, face_description
       FROM students ORDER BY created_at DESC`
    );

    return rows.map((row) => ({
      id: row.id,
      registerNumber: row.register_number,
      name: row.name,
      email: row.email,
      department: row.department,
      enrollmentYear: Number(row.enrollment_year),
      status: row.status,
      faceDescription: row.face_description || undefined
    }));
  }

  async addStudent(student: Student): Promise<void> {
    await this.init();
    this.execute(
      `INSERT INTO students
      (id, register_number, name, email, department, enrollment_year, status, face_description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        student.id,
        student.registerNumber.trim().toUpperCase(),
        student.name.trim(),
        student.email.trim().toLowerCase(),
        student.department,
        student.enrollmentYear,
        student.status,
        student.faceDescription || null,
        new Date().toISOString()
      ]
    );
    this.persist();
  }

  async deleteStudentById(id: string): Promise<void> {
    await this.init();
    this.execute('DELETE FROM students WHERE id = ?', [id]);
    this.persist();
  }

  async deleteStudentCompletely(student: Pick<Student, 'id' | 'registerNumber' | 'name' | 'department'>): Promise<void> {
    await this.init();
    this.execute(
      `DELETE FROM students
       WHERE id = ?
          OR register_number = ?
          OR (LOWER(TRIM(name)) = LOWER(TRIM(?)) AND LOWER(TRIM(department)) = LOWER(TRIM(?)))`,
      [
        student.id,
        student.registerNumber.trim().toUpperCase(),
        student.name.trim(),
        student.department.trim()
      ]
    );
    this.persist();
  }

  private getDatabase(): Database {
    if (!this.db) {
      throw new Error('SQLite database is not initialized.');
    }
    return this.db;
  }

  private createSchema(): void {
    const db = this.getDatabase();
    db.run(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        face_description TEXT NOT NULL,
        recovery_secret TEXT NOT NULL,
        recovery_email TEXT,
        registered_at TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        register_number TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL,
        department TEXT NOT NULL,
        enrollment_year INTEGER NOT NULL,
        status TEXT NOT NULL,
        face_description TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  private importLegacyLocalStorageIfNeeded(): void {
    const migrated = this.getMetadata(LEGACY_MIGRATION_KEY);
    if (migrated === '1') return;

    try {
      const legacyAdminRaw = localStorage.getItem('insight_admin_data');
      if (legacyAdminRaw) {
        const legacyAdmin = JSON.parse(legacyAdminRaw) as AdminProfile;
        if (legacyAdmin?.name && legacyAdmin?.faceDescription && legacyAdmin?.recoverySecret && legacyAdmin?.registeredAt) {
          this.execute(
            `INSERT INTO admins (id, name, face_description, recovery_secret, recovery_email, registered_at)
             VALUES (1, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               face_description = excluded.face_description,
               recovery_secret = excluded.recovery_secret,
               recovery_email = excluded.recovery_email,
               registered_at = excluded.registered_at`,
            [
              legacyAdmin.name.trim(),
              legacyAdmin.faceDescription,
              legacyAdmin.recoverySecret,
              legacyAdmin.recoveryEmail ? legacyAdmin.recoveryEmail.trim().toLowerCase() : null,
              legacyAdmin.registeredAt
            ]
          );
        }
      }

      const legacyStudentsRaw = localStorage.getItem('insight_students');
      if (legacyStudentsRaw) {
        const legacyStudents = JSON.parse(legacyStudentsRaw) as Student[];
        legacyStudents.forEach((student, idx) => {
          if (!student?.id || !student?.name || !student?.department) return;
          this.execute(
            `INSERT OR IGNORE INTO students
            (id, register_number, name, email, department, enrollment_year, status, face_description, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              student.id,
              (student.registerNumber || student.id || `REG${idx + 1}`).trim().toUpperCase(),
              student.name.trim(),
              (student.email || `${student.name.toLowerCase().replace(/\s/g, '.')}@uni.ac.in`).trim().toLowerCase(),
              student.department,
              student.enrollmentYear || new Date().getFullYear(),
              student.status || 'Present',
              student.faceDescription || null,
              new Date().toISOString()
            ]
          );
        });
      }
    } catch (error) {
      console.error('Legacy localStorage migration failed:', error);
    } finally {
      this.setMetadata(LEGACY_MIGRATION_KEY, '1');
    }
  }

  private loadPersistedDatabase(): Uint8Array | null {
    try {
      const encoded = localStorage.getItem(DB_STORAGE_KEY);
      if (!encoded) return null;

      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (error) {
      console.error('Failed to decode persisted SQLite DB:', error);
      return null;
    }
  }

  private persist(): void {
    const db = this.getDatabase();
    const bytes = db.export();
    localStorage.setItem(DB_STORAGE_KEY, this.encodeBytes(bytes));
  }

  private encodeBytes(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private execute(sql: string, params: QueryParam[] = []): void {
    const db = this.getDatabase();
    const stmt = db.prepare(sql);
    stmt.bind(params as unknown as Record<string, QueryParam>);
    stmt.step();
    stmt.free();
  }

  private query<T extends Record<string, unknown>>(sql: string, params: QueryParam[] = []): T[] {
    const db = this.getDatabase();
    const stmt = db.prepare(sql);
    stmt.bind(params as unknown as Record<string, QueryParam>);

    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }

    stmt.free();
    return rows;
  }

  private getMetadata(key: string): string | null {
    const rows = this.query<{ value: string }>('SELECT value FROM metadata WHERE key = ? LIMIT 1', [key]);
    return rows[0]?.value || null;
  }

  private setMetadata(key: string, value: string): void {
    this.execute(
      `INSERT INTO metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  }
}

export const sqliteService = new SQLiteService();
