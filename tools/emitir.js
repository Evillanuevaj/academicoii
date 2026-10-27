#!/usr/bin/env node
"use strict";

/*
 * Emisor de certificados firmados para el sitio de validación Ferreyros.
 *
 *   node tools/emitir.js claves [--forzar]
 *       Genera el par de claves ECDSA P-256.
 *       - .claves/privada.pem  (NO se sube a GitHub)
 *       - js/public-key.js     (sí se publica; el navegador verifica con ella)
 *
 *   node tools/emitir.js qr --base https://usuario.github.io/repo/ [--datos datos/certificados.json] [--dias 730]
 *       Firma cada certificado y genera en salida/:
 *       - qr/<codigo>.png y qr/<codigo>.svg   (para incrustar en el certificado físico)
 *       - enlaces.csv                          (código y URL firmada)
 *       - certificados.html                    (hoja imprimible de prueba)
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const KEY_DIR = path.join(ROOT, ".claves");
const PRIVATE_KEY = path.join(KEY_DIR, "privada.pem");
const PUBLIC_JS = path.join(ROOT, "js", "public-key.js");
const OUT_DIR = path.join(ROOT, "salida");

const FIELD_MAP = {
  codigo: "c",
  tipo: "t",
  programa: "r",
  participante: "p",
  documento: "d",
  linea: "l",
  sede: "s",
  inicio: "i",
  fin: "f",
  horas: "h",
  emision: "e"
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(item);
    }
  }
  return args;
}

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fail(message) {
  console.error("Error: " + message);
  process.exit(1);
}

function generateKeys(force) {
  if (fs.existsSync(PRIVATE_KEY) && !force) {
    fail("ya existe " + path.relative(ROOT, PRIVATE_KEY) + ". Use --forzar solo si quiere invalidar TODOS los QR emitidos.");
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(PRIVATE_KEY, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

  const jwk = publicKey.export({ format: "jwk" });
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const content =
    "// Clave pública para verificar la firma de los QR. Generada por tools/emitir.js; no contiene secretos.\n" +
    "window.CERT_PUBLIC_KEY = " + JSON.stringify(publicJwk, null, 2) + ";\n";
  fs.writeFileSync(PUBLIC_JS, content);

  console.log("Clave privada: " + path.relative(ROOT, PRIVATE_KEY) + "  (guárdela en un lugar seguro, NO la suba a GitHub)");
  console.log("Clave pública: " + path.relative(ROOT, PUBLIC_JS));
}

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY)) {
    fail("no existe la clave privada. Ejecute primero: node tools/emitir.js claves");
  }
  return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY));
}

function loadCertificates(file) {
  const candidates = file
    ? [path.resolve(process.cwd(), file)]
    : [path.join(ROOT, "datos", "certificados.json"), path.join(ROOT, "datos", "certificados.ejemplo.json")];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    fail("no se encontró el archivo de datos: " + candidates.join(" | "));
  }
  const list = JSON.parse(fs.readFileSync(found, "utf8"));
  if (!Array.isArray(list) || list.length === 0) {
    fail("el archivo de datos debe ser un arreglo con al menos un certificado.");
  }
  console.log("Datos: " + path.relative(ROOT, found) + " (" + list.length + " certificados)");
  return list;
}

function buildPayload(cert, expiresAt) {
  const payload = {};
  Object.keys(FIELD_MAP).forEach((field) => {
    const value = cert[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      payload[FIELD_MAP[field]] = String(value).trim();
    }
  });
  if (!payload.c || !payload.p) {
    fail("cada certificado requiere 'codigo' y 'participante': " + JSON.stringify(cert));
  }
  payload.c = payload.c.toUpperCase();
  if (expiresAt) {
    payload.x = expiresAt;
  }
  return payload;
}

function sign(payload, privateKey) {
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return body + "." + b64url(signature);
}

function normalizeBase(base) {
  let url;
  try {
    url = new URL(base);
  } catch (err) {
    fail("--base debe ser una URL completa, por ejemplo https://usuario.github.io/validacion-certificados/");
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    fail("--base debe usar https (requerido por el navegador para verificar la firma).");
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/") && !url.pathname.endsWith(".html")) {
    url.pathname += "/";
  }
  return url.toString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFileName(code) {
  return code.replace(/[^A-Za-z0-9_-]/g, "_");
}

function printableSheet(rows) {
  const sheets = rows
    .map(({ cert, url, file }) => {
      const facts = [
        ["Participante", cert.participante],
        ["Documento", cert.documento],
        ["Línea", cert.linea],
        ["Sede", cert.sede],
        ["Periodo", [cert.inicio, cert.fin].filter(Boolean).join(" – ")],
        ["Horas", cert.horas],
        ["Código", String(cert.codigo).toUpperCase()]
      ]
        .filter(([, value]) => value)
        .map(([label, value]) => "<div><dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd></div>")
        .join("");
      return (
        '<article class="sheet">' +
        '<header><img src="../assets/img/logo.png" alt="Ferreyros" width="184" height="59"></header>' +
        '<p class="kicker">' + escapeHtml(cert.tipo || "Certificado") + "</p>" +
        "<h1>" + escapeHtml(cert.programa || "") + "</h1>" +
        '<p class="lead">Ferreyros certifica que la persona indicada completó satisfactoriamente el programa descrito.</p>' +
        "<dl>" + facts + "</dl>" +
        '<footer><a href="' + escapeHtml(url) + '"><img src="qr/' + file + '.svg" alt="QR de verificación" width="128" height="128"></a>' +
        "<div><strong>Verifique la autenticidad</strong><p>Escanee este código QR con la cámara de su celular.</p></div></footer>" +
        "</article>"
      );
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Certificados de prueba | Ferreyros</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:24px 16px;background:#ececec;font-family:Roboto,"Segoe UI",Arial,sans-serif;color:#111}
  .bar{max-width:860px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px}
  .bar button{border:0;background:#111;color:#ffcd11;font-weight:700;padding:10px 14px;cursor:pointer}
  .sheet{max-width:860px;margin:0 auto 28px;background:#fff;border:10px solid #111;outline:4px solid #ffcd11;outline-offset:-16px;padding:36px 42px 28px}
  .sheet header{border-bottom:4px solid #ffcd11;padding-bottom:14px}
  .kicker{margin:22px 0 0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a6a00}
  h1{margin:8px 0 0;font-size:30px;line-height:1.15}
  .lead{color:#333;line-height:1.5}
  dl{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;margin:20px 0 0}
  dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#666}
  dd{margin:2px 0 0;font-size:17px;font-weight:700}
  .sheet footer{margin-top:26px;padding-top:16px;border-top:1px solid #e5e5e5;display:flex;gap:16px;align-items:center}
  .sheet footer a{line-height:0;border:1px solid #ddd}
  .sheet footer p{margin:6px 0 0;color:#666}
  @media print{body{background:#fff;padding:0}.bar{display:none}.sheet{outline:none;margin:0;break-after:page}}
</style>
</head>
<body>
<p class="bar"><span>Hoja de prueba generada por tools/emitir.js. Imprima o escanee los QR desde la pantalla.</span><button type="button" onclick="window.print()">Imprimir</button></p>
${sheets}
</body>
</html>
`;
}

async function generateQr(args) {
  if (!args.base || args.base === true) {
    fail("indique --base con la URL pública del sitio, por ejemplo --base https://usuario.github.io/validacion-certificados/");
  }
  let QRCode;
  try {
    QRCode = require("qrcode");
  } catch (err) {
    fail("falta la dependencia 'qrcode'. Ejecute: npm install");
  }

  const base = normalizeBase(args.base);
  const days = args.dias ? Number(args.dias) : 0;
  if (Number.isNaN(days) || days < 0) {
    fail("--dias debe ser un número positivo.");
  }
  const expiresAt = days ? Math.floor(Date.now() / 1000) + days * 86400 : 0;

  const privateKey = loadPrivateKey();
  const certificates = loadCertificates(args.datos);
  const qrDir = path.join(OUT_DIR, "qr");
  fs.mkdirSync(qrDir, { recursive: true });

  const rows = [];
  const csv = ["codigo,participante,url"];
  for (const cert of certificates) {
    const payload = buildPayload(cert, expiresAt);
    const url = base + "#t=" + sign(payload, privateKey);
    const file = safeFileName(payload.c);
    const options = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#111111", light: "#ffffff" } };
    await QRCode.toFile(path.join(qrDir, file + ".png"), url, Object.assign({ width: 600 }, options));
    fs.writeFileSync(path.join(qrDir, file + ".svg"), await QRCode.toString(url, Object.assign({ type: "svg" }, options)));
    csv.push([payload.c, '"' + payload.p.replace(/"/g, '""') + '"', url].join(","));
    rows.push({ cert, url, file });
    console.log(payload.c + "  ->  " + url.length + " caracteres");
  }

  fs.writeFileSync(path.join(OUT_DIR, "enlaces.csv"), "\ufeff" + csv.join("\r\n") + "\r\n");
  fs.writeFileSync(path.join(OUT_DIR, "certificados.html"), printableSheet(rows));
  console.log("\nGenerado en " + path.relative(ROOT, OUT_DIR) + "/ : qr/*.png, qr/*.svg, enlaces.csv, certificados.html");
  if (expiresAt) {
    console.log("Los enlaces vencen el " + new Date(expiresAt * 1000).toISOString().slice(0, 10));
  }
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (command === "claves") {
  generateKeys(Boolean(args.forzar));
} else if (command === "qr") {
  generateQr(args).catch((err) => fail(err.message));
} else {
  console.log("Uso:\n  node tools/emitir.js claves [--forzar]\n  node tools/emitir.js qr --base <url-del-sitio> [--datos archivo.json] [--dias N]");
  process.exit(command ? 1 : 0);
}
