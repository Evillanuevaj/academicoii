#!/usr/bin/env node
"use strict";

/*
 * Emisor de certificados para el sitio de validación Ferreyros.
 *
 *   node tools/emitir.js secreto [--forzar]
 *       Crea .claves/secreto.key (NO se sube a GitHub). Con él se derivan los códigos de 8 caracteres;
 *       el mismo certificado siempre obtiene el mismo código.
 *
 *   node tools/emitir.js validar [--datos archivo.json]
 *       Revisa los datos (nombres, fechas, códigos, ortografía) sin generar nada.
 *
 *   node tools/emitir.js qr --base https://usuario.github.io/repo/ [--datos archivo.json] [--solo CODIGO] [--limite N] [--dias N]
 *       Por cada certificado:
 *       - registros/<id>.json            registro cifrado (SÍ se publica; ilegible sin el código)
 *       - salida/qr/<codigo>.png|.svg    QR para el certificado físico
 *       - salida/enlaces.csv             código interno, participante, código QR y URL
 *       - salida/certificados.html       hoja imprimible de prueba
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SECRET_FILE = path.join(ROOT, ".claves", "secreto.key");
const RECORDS_DIR = path.join(ROOT, "registros");
const OUT_DIR = path.join(ROOT, "salida");

// Deben coincidir con js/script.js.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const KDF_SALT = "ferreyros-certificaciones-v1";
const KDF_ITERATIONS = 150000;

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

function fail(message) {
  console.error("Error: " + message);
  process.exit(1);
}

function createSecret(force) {
  if (fs.existsSync(SECRET_FILE) && !force) {
    fail("ya existe " + path.relative(ROOT, SECRET_FILE) + ". Use --forzar solo si quiere cambiar TODOS los códigos ya emitidos.");
  }
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
  console.log("Secreto creado: " + path.relative(ROOT, SECRET_FILE) + "  (respáldelo; NO lo suba a GitHub)");
}

function loadSecret() {
  if (!fs.existsSync(SECRET_FILE)) {
    fail("no existe el secreto. Ejecute primero: node tools/emitir.js secreto");
  }
  return Buffer.from(fs.readFileSync(SECRET_FILE, "utf8").trim(), "hex");
}

// Código de 8 caracteres (40 bits) derivado de forma estable del código interno.
function verificationCode(secret, internalCode) {
  const digest = crypto.createHmac("sha256", secret).update("codigo:" + internalCode).digest();
  let bits = 0n;
  for (let i = 0; i < 5; i++) {
    bits = (bits << 8n) | BigInt(digest[i]);
  }
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code = ALPHABET[Number(bits & 31n)] + code;
    bits >>= 5n;
  }
  return code;
}

function deriveRecordKeys(code) {
  const bytes = crypto.pbkdf2Sync(Buffer.from(code), Buffer.from(KDF_SALT), KDF_ITERATIONS, 48, "sha256");
  return { id: bytes.subarray(0, 16).toString("hex"), key: bytes.subarray(16, 48) };
}

function encryptRecord(key, payload) {
  const plain = Buffer.from(JSON.stringify(payload));
  // IV determinista (SIV): misma entrada -> mismo archivo, sin reutilizar IV con contenido distinto.
  const iv = crypto.createHmac("sha256", key).update(plain).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString("base64"), ct: ct.toString("base64") };
}

function loadCertificates(file) {
  const candidates = file
    ? [path.resolve(process.cwd(), file)]
    : [path.join(ROOT, "datos", "certificados.json"), path.join(ROOT, "datos", "certificados.ejemplo.json")];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    fail("no se encontró el archivo de datos: " + candidates.join(" | "));
  }
  const list = JSON.parse(fs.readFileSync(found, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(list) || list.length === 0) {
    fail("el archivo de datos debe ser un arreglo con al menos un certificado.");
  }
  console.log("Datos: " + path.relative(ROOT, found) + " (" + list.length + " certificados)");
  return list;
}

// ---------------------------------------------------------------------------
// Normalización y validación de datos
// ---------------------------------------------------------------------------

const TEXT_FIELDS = ["codigo", "tipo", "programa", "apellidos", "nombres", "participante", "documento", "linea", "sede", "inicio", "fin", "horas", "emision"];
const REQUIRED_FIELDS = ["codigo", "tipo", "programa", "documento", "linea", "sede", "inicio", "fin", "horas", "emision"];
const NAME_PATTERN = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/;
const LOWER_PARTICLES = new Set(["de", "del", "la", "las", "los", "y"]);

// Palabras frecuentes sin tilde en campos descriptivos (tipo, programa, línea, sede).
const SPELLING = {
  capacitacion: "capacitación",
  operacion: "operación",
  tecnico: "técnico",
  tecnica: "técnica",
  hidraulica: "hidráulica",
  hidraulico: "hidráulico",
  electrogenos: "electrógenos",
  electrogeno: "electrógeno",
  energia: "energía",
  mecanica: "mecánica",
  mecanico: "mecánico",
  electrica: "eléctrica",
  electrico: "eléctrico",
  tecnologia: "tecnología",
  mineria: "minería",
  practica: "práctica",
  basico: "básico",
  basica: "básica",
  modulo: "módulo",
  gestion: "gestión",
  inspeccion: "inspección",
  diagnostico: "diagnóstico",
  linea: "línea",
  camion: "camión",
  traccion: "tracción",
  formacion: "formación",
  certificacion: "certificación",
  prevencion: "prevención",
  conduccion: "conducción",
  produccion: "producción",
  construccion: "construcción",
  informacion: "información",
  atencion: "atención",
  evaluacion: "evaluación",
  actualizacion: "actualización",
  peru: "Perú"
};

// Nombres y apellidos que suelen llevar tilde. Solo se advierte: debe coincidir con el DNI.
const NAME_ACCENTS = {
  jesus: "Jesús", jose: "José", maria: "María", angel: "Ángel", ivan: "Iván", hector: "Héctor", oscar: "Óscar",
  cesar: "César", raul: "Raúl", julian: "Julián", martin: "Martín", andres: "Andrés", ruben: "Rubén",
  victor: "Víctor", adrian: "Adrián", simon: "Simón", german: "Germán", sebastian: "Sebastián",
  nicolas: "Nicolás", tomas: "Tomás", elias: "Elías", matias: "Matías", moises: "Moisés", ines: "Inés",
  belen: "Belén", monica: "Mónica", veronica: "Verónica", angelica: "Angélica", ramon: "Ramón",
  joaquin: "Joaquín", agustin: "Agustín", efrain: "Efraín", fermin: "Fermín", benjamin: "Benjamín",
  vasquez: "Vásquez", velasquez: "Velásquez", castrejon: "Castrejón", ramirez: "Ramírez", gonzalez: "González",
  martinez: "Martínez", perez: "Pérez", lopez: "López", sanchez: "Sánchez", hernandez: "Hernández",
  rodriguez: "Rodríguez", diaz: "Díaz", garcia: "García", gomez: "Gómez", gutierrez: "Gutiérrez",
  fernandez: "Fernández", chavez: "Chávez", alvarez: "Álvarez", jimenez: "Jiménez", nunez: "Núñez",
  rios: "Ríos", leon: "León", marin: "Marín", tellez: "Téllez", suarez: "Suárez",
  ibanez: "Ibáñez", munoz: "Muñoz", calderon: "Calderón", alarcon: "Alarcón", rincon: "Rincón",
  cardenas: "Cárdenas", cespedes: "Céspedes", mendez: "Méndez", benitez: "Benítez",
  dominguez: "Domínguez", marquez: "Márquez", vazquez: "Vázquez", ordonez: "Ordóñez"
};

function cleanText(value) {
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function upperSurnames(value) {
  return cleanText(value).toLocaleUpperCase("es-PE");
}

function titleNames(value) {
  return cleanText(value)
    .toLocaleLowerCase("es-PE")
    .split(" ")
    .map((word, index) =>
      index > 0 && LOWER_PARTICLES.has(word)
        ? word
        : word.replace(/(^|[-'])(\p{L})/gu, (m, sep, ch) => sep + ch.toLocaleUpperCase("es-PE"))
    )
    .join(" ");
}

function parseDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || "");
  if (!match) {
    return null;
  }
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function wordsOf(value) {
  return String(value || "").split(/[^\p{L}]+/u).filter(Boolean);
}

function normalizeCertificate(raw) {
  const cert = {};
  TEXT_FIELDS.forEach((field) => {
    if (raw[field] !== undefined && raw[field] !== null && cleanText(raw[field]) !== "") {
      cert[field] = cleanText(raw[field]);
    }
  });
  if (cert.codigo) {
    cert.codigo = cert.codigo.toUpperCase();
  }
  if (cert.documento) {
    cert.documento = cert.documento.toUpperCase();
  }
  if (!cert.apellidos && !cert.nombres && cert.participante && cert.participante.includes(",")) {
    const [apellidos, ...rest] = cert.participante.split(",");
    cert.apellidos = cleanText(apellidos);
    cert.nombres = cleanText(rest.join(" "));
  }
  if (cert.apellidos && cert.nombres) {
    cert.apellidos = upperSurnames(cert.apellidos);
    cert.nombres = titleNames(cert.nombres);
    cert.participante = cert.apellidos + ", " + cert.nombres;
  }
  return cert;
}

function validateCertificates(list) {
  const errors = [];
  const warnings = [];
  const seenCodes = new Map();
  const seenDocs = new Map();

  list.forEach((cert, index) => {
    const where = (cert.codigo || "registro #" + (index + 1)) + ": ";
    REQUIRED_FIELDS.forEach((field) => {
      if (!cert[field]) {
        errors.push(where + "falta el campo '" + field + "'.");
      }
    });

    if (cert.codigo) {
      if (!/^FRY-[A-Z]{3}-\d{4}-\d{4}$/.test(cert.codigo)) {
        errors.push(where + "el código debe tener el formato FRY-XXX-AAAA-NNNN.");
      }
      if (seenCodes.has(cert.codigo)) {
        errors.push(where + "código duplicado (también en el registro #" + seenCodes.get(cert.codigo) + ").");
      }
      seenCodes.set(cert.codigo, index + 1);
    }

    if (!cert.apellidos || !cert.nombres) {
      errors.push(where + "use los campos 'apellidos' y 'nombres' (o 'participante' con el formato \"Apellidos, Nombres\").");
    } else {
      [["apellidos", cert.apellidos], ["nombres", cert.nombres]].forEach(([field, value]) => {
        if (!NAME_PATTERN.test(value)) {
          errors.push(where + "'" + field + "' contiene caracteres no válidos: \"" + value + "\".");
        }
      });
      if (wordsOf(cert.apellidos).length < 2) {
        warnings.push(where + "solo tiene un apellido (\"" + cert.apellidos + "\"); verifique con el DNI.");
      }
      wordsOf(cert.apellidos + " " + cert.nombres).forEach((word) => {
        const hint = NAME_ACCENTS[word.toLocaleLowerCase("es-PE")];
        if (hint) {
          warnings.push(where + "\"" + word + "\" suele escribirse \"" + hint + "\"; confirme con el DNI.");
        }
      });
    }

    if (cert.documento) {
      if (!/^(DNI \*{4}\d{4}|CE \*{4}\d{4,5}|PAS \*{4}[A-Z0-9]{4})$/.test(cert.documento)) {
        errors.push(where + "documento con formato inválido (\"" + cert.documento + "\"); use p. ej. \"DNI ****1234\".");
      } else {
        if (seenDocs.has(cert.documento) && seenDocs.get(cert.documento).programa === cert.programa) {
          warnings.push(where + "mismo documento y programa que " + seenDocs.get(cert.documento).codigo + "; ¿registro duplicado?");
        }
        seenDocs.set(cert.documento, cert);
      }
    }

    const dates = {};
    ["inicio", "fin", "emision"].forEach((field) => {
      if (cert[field]) {
        dates[field] = parseDate(cert[field]);
        if (!dates[field]) {
          errors.push(where + "fecha '" + field + "' inválida (\"" + cert[field] + "\"); use dd/mm/aaaa.");
        }
      }
    });
    if (dates.inicio && dates.fin && dates.inicio > dates.fin) {
      errors.push(where + "la fecha de inicio es posterior a la de fin.");
    }
    if (dates.fin && dates.emision && dates.fin > dates.emision) {
      errors.push(where + "la fecha de emisión es anterior a la de fin.");
    }
    if (cert.codigo && dates.inicio && /^FRY-[A-Z]{3}-\d{4}/.test(cert.codigo)) {
      const year = Number(cert.codigo.slice(8, 12));
      if (year !== dates.inicio.getUTCFullYear() && (!dates.fin || year !== dates.fin.getUTCFullYear())) {
        warnings.push(where + "el año del código (" + year + ") no coincide con el periodo del curso.");
      }
    }

    if (cert.horas && !/^[1-9]\d{0,3}$/.test(cert.horas)) {
      errors.push(where + "'horas' debe ser un número entero positivo (\"" + cert.horas + "\").");
    }

    ["tipo", "programa", "linea", "sede"].forEach((field) => {
      wordsOf(cert[field]).forEach((word) => {
        const fix = SPELLING[word.toLocaleLowerCase("es-PE")];
        if (fix && word.toLocaleLowerCase("es-PE") !== fix.toLocaleLowerCase("es-PE")) {
          const suggestion = word[0] === word[0].toLocaleUpperCase("es-PE") ? fix[0].toLocaleUpperCase("es-PE") + fix.slice(1) : fix;
          errors.push(where + "'" + field + "': \"" + word + "\" debe escribirse \"" + suggestion + "\".");
        }
      });
      if (cert[field] && cert[field][0] !== cert[field][0].toLocaleUpperCase("es-PE")) {
        warnings.push(where + "'" + field + "' debería iniciar con mayúscula.");
      }
    });
  });

  return { errors, warnings };
}

function checkData(list) {
  const normalized = list.map(normalizeCertificate);
  const { errors, warnings } = validateCertificates(normalized);
  warnings.forEach((message) => console.warn("  Aviso: " + message));
  if (errors.length) {
    errors.forEach((message) => console.error("  Error: " + message));
    fail(errors.length + " error(es) en los datos. Corríjalos antes de emitir.");
  }
  console.log("Validación: " + normalized.length + " certificados correctos" + (warnings.length ? " (" + warnings.length + " aviso(s))" : "") + ".");
  return normalized;
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

function normalizeBase(base) {
  let url;
  try {
    url = new URL(base);
  } catch (err) {
    fail("--base debe ser una URL completa, por ejemplo https://usuario.github.io/repo/");
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    fail("--base debe usar https (requerido por el navegador para verificar el certificado).");
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) {
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
    .map(({ cert, url, file, code }) => {
      const facts = [
        ["Apellidos y nombres", cert.participante],
        ["Documento", cert.documento],
        ["Línea", cert.linea],
        ["Sede", cert.sede],
        ["Periodo", [cert.inicio, cert.fin].filter(Boolean).join(" – ")],
        ["Horas", cert.horas],
        ["N.º de certificado", String(cert.codigo).toUpperCase()]
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
        '<footer><a href="' + escapeHtml(url) + '"><img src="qr/' + file + '.svg" alt="QR de verificación" width="120" height="120"></a>' +
        "<div><strong>Verifique la autenticidad</strong><p>Escanee este código QR con la cámara de su celular.</p>" +
        '<p class="code">Código de verificación: <b>' + escapeHtml(code) + "</b></p></div></footer>" +
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
  .sheet footer .code b{color:#111;letter-spacing:.12em}
  @media print{body{background:#fff;padding:0}.bar{display:none}.sheet{outline:none;margin:0;break-after:page}}
  @media (max-width:640px){.sheet{padding:28px 18px 20px}dl{grid-template-columns:1fr}}
</style>
</head>
<body>
<p class="bar"><span>Hoja de prueba generada por tools/emitir.js. Imprima o escanee los QR desde la pantalla.</span><button type="button" onclick="window.print()">Imprimir</button></p>
${sheets}
</body>
</html>
`;
}

async function generate(args) {
  if (!args.base || args.base === true) {
    fail("indique --base con la URL pública del sitio, por ejemplo --base https://usuario.github.io/repo/");
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
  const secret = loadSecret();

  let certificates = checkData(loadCertificates(args.datos));
  if (args.solo && args.solo !== true) {
    const wanted = String(args.solo).toUpperCase();
    certificates = certificates.filter((cert) => String(cert.codigo || "").toUpperCase() === wanted);
    if (certificates.length === 0) {
      fail("no existe el certificado " + wanted + " en el archivo de datos.");
    }
  }
  if (args.limite && args.limite !== true) {
    certificates = certificates.slice(0, Math.max(1, Number(args.limite)));
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const qrDir = path.join(OUT_DIR, "qr");
  fs.mkdirSync(qrDir, { recursive: true });
  fs.mkdirSync(RECORDS_DIR, { recursive: true });

  const seen = new Map();
  const rows = [];
  const csv = ["codigo_certificado,participante,codigo_verificacion,url"];
  for (const cert of certificates) {
    const payload = buildPayload(cert, expiresAt);
    const code = verificationCode(secret, payload.c);
    if (seen.has(code) && seen.get(code) !== payload.c) {
      fail("colisión de código " + code + " entre " + seen.get(code) + " y " + payload.c);
    }
    seen.set(code, payload.c);

    const { id, key } = deriveRecordKeys(code);
    fs.writeFileSync(path.join(RECORDS_DIR, id + ".json"), JSON.stringify(encryptRecord(key, payload)) + "\n");

    const url = base + "certificaciones/" + code;
    const file = safeFileName(payload.c);
    const options = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#111111", light: "#ffffff" } };
    await QRCode.toFile(path.join(qrDir, file + ".png"), url, Object.assign({ width: 600 }, options));
    fs.writeFileSync(path.join(qrDir, file + ".svg"), await QRCode.toString(url, Object.assign({ type: "svg" }, options)));

    csv.push([payload.c, '"' + payload.p.replace(/"/g, '""') + '"', code, url].join(","));
    rows.push({ cert, url, file, code });
    console.log(payload.c.padEnd(20) + code + "  " + url);
  }

  fs.writeFileSync(path.join(OUT_DIR, "enlaces.csv"), "\ufeff" + csv.join("\r\n") + "\r\n");
  fs.writeFileSync(path.join(OUT_DIR, "certificados.html"), printableSheet(rows));
  console.log("\nRegistros cifrados en registros/ (publíquelos en GitHub).");
  console.log("QR y hoja de prueba en salida/ (no se publican).");
  if (expiresAt) {
    console.log("La verificación vence el " + new Date(expiresAt * 1000).toISOString().slice(0, 10));
  }
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (command === "secreto") {
  createSecret(Boolean(args.forzar));
} else if (command === "validar") {
  checkData(loadCertificates(args.datos));
} else if (command === "qr") {
  generate(args).catch((err) => fail(err.message));
} else {
  console.log(
    "Uso:\n  node tools/emitir.js secreto [--forzar]\n  node tools/emitir.js validar [--datos archivo.json]\n" +
      "  node tools/emitir.js qr --base <url-del-sitio> [--datos archivo.json] [--solo CODIGO] [--limite N] [--dias N]"
  );
  process.exit(command ? 1 : 0);
}