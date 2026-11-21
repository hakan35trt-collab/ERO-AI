import fs from "node:fs";

const payload = {
  name: "ERO",
  built: new Date().toISOString(),
};
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/version.json", `${JSON.stringify(payload)}\n`);
