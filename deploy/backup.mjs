import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const root = path.resolve(import.meta.dirname, ".."),
  data = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const dest = path.resolve(
  process.argv[2] || path.join(root, "backups", new Date().toISOString().replace(/[:.]/g, "-")),
);
if (dest === data || dest.startsWith(data + path.sep)) throw Error("备份目录不能位于data内部");
fs.mkdirSync(dest, {
  recursive: true,
  mode: 0o700,
});
const db = new DatabaseSync(path.join(data, "onestaff.db"));
const target = path.join(dest, "onestaff.db").replace(/'/g, "''");
db.exec(`VACUUM INTO '${target}'`);
db.close();
for (const name of fs.readdirSync(data)) {
  if (name.startsWith("onestaff.db")) continue;
  fs.cpSync(path.join(data, name), path.join(dest, name), {
    recursive: true,
  });
}
const env = path.join(root, ".env");
if (fs.existsSync(env)) fs.copyFileSync(env, path.join(dest, ".env.backup"));
console.log("备份完成：" + dest + "。其中含加密主密钥与服务配置，请妥善保管。");
