// Builds plugin/ (index.js + style.css + plugin.json) and a zip ready to install in GeoLibre.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const out = join(root, "plugin");

// core.js keeps its exports for the tests; inside the bundle they are plain declarations.
const core = readFileSync(join(root, "src", "core.js"), "utf8").replace(/^export (?=(async )?function |const )/gm, "");
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const win = readFileSync(join(root, "src", "win.js"), "utf8");
const gpu = readFileSync(join(root, "src", "gpu.js"), "utf8");
if (!main.includes(`const VERSION = "${manifest.version}"`)) throw new Error("VERSION in src/main.js does not match plugin.json");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.version !== manifest.version) throw new Error("version in package.json does not match plugin.json");
// esbuild from this repo (npm install); GEOLIBRE_REPO points at another checkout that has it, if preferred.
const esbuild = createRequire(join(process.env.GEOLIBRE_REPO || root, "package.json"))("esbuild");
const { code } = await esbuild.transform(`${core}\n${gpu}\n${main}\n${win}`, { format: "esm", minify: true, target: "es2022", legalComments: "none" });

// only now that the bundle exists is the previous build replaced
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.js"), `/*! Image Classification ${manifest.version} | MIT License | Defani Arman Alfitriansyah */\n${code}`);
cpSync(join(root, "src", "style.css"), join(out, "style.css"));
cpSync(join(root, "plugin.json"), join(out, "plugin.json"));
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

const zip = join(root, `${manifest.id}-${manifest.version}.zip`);
rmSync(zip, { force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
console.log("built", out, "and", zip);
