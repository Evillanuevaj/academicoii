#!/usr/bin/env node
"use strict";

// Servidor estático para pruebas locales. Imita a GitHub Pages:
// carpetas -> index.html y rutas inexistentes -> 404.html (página de validación).
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};
const BLOCKED = [".claves", "node_modules", "tools", "datos", ".git"].map((dir) => path.join(ROOT, dir));

function send(res, status, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end("Error");
      return;
    }
    res.writeHead(status, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://" + HOST).pathname);
    } catch (err) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    const target = path.normalize(path.join(ROOT, pathname));
    if (!(target === ROOT || target.startsWith(ROOT + path.sep)) || BLOCKED.some((dir) => target.startsWith(dir))) {
      send(res, 404, path.join(ROOT, "404.html"));
      return;
    }
    fs.stat(target, (err, stat) => {
      if (!err && stat.isDirectory()) {
        if (!pathname.endsWith("/")) {
          res.writeHead(301, { Location: pathname + "/" });
          res.end();
          return;
        }
        const index = path.join(target, "index.html");
        fs.access(index, (missing) => send(res, missing ? 404 : 200, missing ? path.join(ROOT, "404.html") : index));
        return;
      }
      if (!err && stat.isFile()) {
        send(res, 200, target);
        return;
      }
      send(res, 404, path.join(ROOT, "404.html"));
    });
  })
  .listen(PORT, HOST, () => {
    console.log("Sitio local: http://" + HOST + ":" + PORT + "/  (redirige a ferreyros.com.pe)");
    console.log("Hoja de prueba: http://" + HOST + ":" + PORT + "/salida/certificados.html");
  });