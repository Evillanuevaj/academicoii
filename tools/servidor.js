#!/usr/bin/env node
"use strict";

// Servidor estático solo para pruebas locales (GitHub Pages no lo necesita).
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
    if (pathname.endsWith("/")) {
      pathname += "index.html";
    }
    const file = path.normalize(path.join(ROOT, pathname));
    const blocked = file.startsWith(path.join(ROOT, ".claves")) || file.startsWith(path.join(ROOT, "node_modules"));
    if (!file.startsWith(ROOT + path.sep) || blocked) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => {
    console.log("Sitio local: http://" + HOST + ":" + PORT + "/");
    console.log("Hoja de prueba: http://" + HOST + ":" + PORT + "/salida/certificados.html");
  });
