// Loads server/.env into process.env as an import side-effect. Import this
// FIRST (before db.js or anything that reads env at module load) so the values
// are available in time. No dependency — a tiny hand-rolled .env parser.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
try {
  if (fs.existsSync(envPath)) {
    for (const raw of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
} catch {
  /* ignore a malformed .env */
}
