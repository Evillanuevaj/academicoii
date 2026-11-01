(function () {
  "use strict";

  // Debe coincidir con tools/emitir.js.
  var CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
  var KDF_SALT = "ferreyros-certificaciones-v1";
  var KDF_ITERATIONS = 150000;

  // Campos del registro (claves cortas).
  var FIELDS = [
    ["p", "Apellidos y nombres", true],
    ["d", "Documento", false],
    ["l", "Línea", false],
    ["s", "Sede", false],
    ["i", "Inicio", false],
    ["f", "Fin", false],
    ["h", "Horas", false],
    ["e", "Emisión", false]
  ];

  var loading = document.getElementById("loading");
  var gate = document.getElementById("gate");
  var result = document.getElementById("result");
  document.getElementById("year").textContent = String(new Date().getFullYear());

  var code = readCode();
  if (!code) {
    showGate(
      "Código no válido",
      "La dirección no corresponde a un certificado emitido por Ferreyros. Escanee nuevamente el código QR del documento físico.",
      true
    );
    return;
  }

  lookup(code)
    .then(function (record) {
      if (!record) {
        showGate(
          "Certificado no encontrado",
          "El código " + code + " no corresponde a un certificado emitido por Ferreyros. Verifique que escaneó el QR del documento físico.",
          true
        );
        return;
      }
      if (typeof record.x === "number" && record.x < Math.floor(Date.now() / 1000)) {
        showGate("Verificación vencida", "El periodo de verificación de este certificado venció. Solicite a Ferreyros una reemisión.", true);
        return;
      }
      return isRevoked(record.c).then(function (revoked) {
        if (revoked) {
          showGate("Certificado revocado", "Ferreyros anuló este certificado. No debe considerarse válido.", true);
          return;
        }
        showCertificate(code, record);
      });
    })
    .catch(function (error) {
      if (error && error.message === "unsupported") {
        showGate(
          "Navegador no compatible",
          "Abra el enlace desde un navegador actualizado y por HTTPS para verificar el certificado.",
          true
        );
        return;
      }
      showGate("No se pudo verificar", "Ocurrió un problema al consultar el certificado. Intente nuevamente en unos minutos.", true);
    });

  function readCode() {
    var match = window.location.pathname.match(/\/certificaciones\/([^/]+)\/?$/);
    if (!match) {
      return "";
    }
    var value = decodeURIComponent(match[1]).toUpperCase().replace(/[-\s]/g, "");
    return CODE_PATTERN.test(value) ? value : "";
  }

  function lookup(value) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error("unsupported"));
    }
    var subtle = window.crypto.subtle;
    var encoder = new TextEncoder();
    var recordId;

    return subtle
      .importKey("raw", encoder.encode(value), "PBKDF2", false, ["deriveBits"])
      .then(function (baseKey) {
        return subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(KDF_SALT), iterations: KDF_ITERATIONS },
          baseKey,
          384
        );
      })
      .then(function (bits) {
        var bytes = new Uint8Array(bits);
        recordId = toHex(bytes.slice(0, 16));
        return subtle.importKey("raw", bytes.slice(16, 48), { name: "AES-GCM" }, false, ["decrypt"]);
      })
      .then(function (aesKey) {
        return fetch("../registros/" + recordId + ".json", { cache: "no-store" }).then(function (response) {
          if (response.status === 404) {
            return null;
          }
          if (!response.ok) {
            throw new Error("network");
          }
          return response.json().then(function (file) {
            return subtle
              .decrypt({ name: "AES-GCM", iv: b64ToBytes(file.iv) }, aesKey, b64ToBytes(file.ct))
              .then(function (plain) {
                return JSON.parse(new TextDecoder().decode(plain));
              });
          });
        });
      });
  }

  function isRevoked(internalCode) {
    return fetch("../revocados.json", { cache: "no-store" })
      .then(function (response) {
        return response.ok ? response.json() : [];
      })
      .then(function (list) {
        return Array.isArray(list) && list.indexOf(internalCode) !== -1;
      })
      .catch(function () {
        return false;
      });
  }

  function toHex(bytes) {
    return Array.prototype.map.call(bytes, function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }

  function b64ToBytes(text) {
    var binary = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function showGate(title, text, invalid) {
    loading.hidden = true;
    result.hidden = true;
    gate.hidden = false;
    var badge = gate.querySelector(".badge");
    badge.textContent = invalid ? "No válido" : "Acceso restringido";
    badge.classList.toggle("badge--invalid", invalid);
    badge.classList.toggle("badge--locked", !invalid);
    document.getElementById("gate-title").textContent = title;
    document.getElementById("gate-text").textContent = text;
  }

  function showCertificate(value, record) {
    loading.hidden = true;
    gate.hidden = true;
    result.hidden = false;

    document.getElementById("cert-type").textContent = record.t || "Certificado";
    document.getElementById("cert-title").textContent = record.r || "";
    document.getElementById("cert-qr").textContent = value;
    document.getElementById("cert-code").textContent = record.c;

    var facts = document.getElementById("facts");
    facts.textContent = "";
    FIELDS.forEach(function (field) {
      var data = record[field[0]];
      if (data === undefined || data === null || data === "") {
        return;
      }
      var item = document.createElement("div");
      if (field[2]) {
        item.className = "is-wide";
      }
      var dt = document.createElement("dt");
      dt.textContent = field[1];
      var dd = document.createElement("dd");
      dd.textContent = String(data);
      item.appendChild(dt);
      item.appendChild(dd);
      facts.appendChild(item);
    });
  }
})();