(function () {
  "use strict";

  // Campos del payload firmado (claves cortas para que el QR sea más pequeño).
  var FIELDS = [
    ["p", "Participante", true],
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

  var token = readToken();
  if (!token) {
    showGate(
      "Escanee el código QR del certificado",
      "Esta verificación solo se abre desde el código QR impreso en el certificado físico. Los datos no se muestran ingresando la dirección manualmente.",
      false
    );
    return;
  }

  verify(token)
    .then(function (payload) {
      return isRevoked(payload.c).then(function (revoked) {
        if (revoked) {
          showGate("Certificado revocado", "Ferreyros anuló este certificado. No debe considerarse válido.", true);
          return;
        }
        showCertificate(payload);
      });
    })
    .catch(function (error) {
      if (error && error.message === "expired") {
        showGate("Enlace vencido", "El código QR de este certificado venció. Solicite a Ferreyros una reemisión.", true);
        return;
      }
      if (error && error.message === "unsupported") {
        showGate(
          "Navegador no compatible",
          "Abra el enlace desde un navegador actualizado y por HTTPS para verificar la firma digital.",
          true
        );
        return;
      }
      showGate(
        "No se pudo validar el certificado",
        "El enlace fue alterado o no corresponde a un certificado emitido por Ferreyros. Escanee nuevamente el QR del documento físico.",
        true
      );
    });

  function readToken() {
    var hash = window.location.hash.replace(/^#/, "");
    var fromHash = new URLSearchParams(hash).get("t");
    if (fromHash) {
      return fromHash;
    }
    return new URLSearchParams(window.location.search).get("t") || "";
  }

  function verify(value) {
    if (!window.crypto || !window.crypto.subtle || !window.CERT_PUBLIC_KEY) {
      return Promise.reject(new Error("unsupported"));
    }
    var parts = value.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return Promise.reject(new Error("invalid"));
    }

    var signature;
    var payload;
    try {
      signature = b64urlToBytes(parts[1]);
      payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    } catch (err) {
      return Promise.reject(new Error("invalid"));
    }

    return window.crypto.subtle
      .importKey("jwk", window.CERT_PUBLIC_KEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
      .then(function (key) {
        return window.crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          signature,
          new TextEncoder().encode(parts[0])
        );
      })
      .then(function (ok) {
        if (!ok || !payload || typeof payload.c !== "string" || typeof payload.p !== "string") {
          throw new Error("invalid");
        }
        if (typeof payload.x === "number" && payload.x < Math.floor(Date.now() / 1000)) {
          throw new Error("expired");
        }
        return payload;
      });
  }

  function isRevoked(code) {
    return fetch("revocados.json", { cache: "no-store" })
      .then(function (response) {
        return response.ok ? response.json() : [];
      })
      .then(function (list) {
        return Array.isArray(list) && list.indexOf(code) !== -1;
      })
      .catch(function () {
        return false;
      });
  }

  function b64urlToBytes(text) {
    var base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    var binary = atob(base64);
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

  function showCertificate(payload) {
    loading.hidden = true;
    gate.hidden = true;
    result.hidden = false;

    document.getElementById("cert-type").textContent = payload.t || "Certificado";
    document.getElementById("cert-title").textContent = payload.r || "";
    document.getElementById("cert-code").textContent = payload.c;

    var facts = document.getElementById("facts");
    facts.textContent = "";
    FIELDS.forEach(function (field) {
      var value = payload[field[0]];
      if (value === undefined || value === null || value === "") {
        return;
      }
      var item = document.createElement("div");
      if (field[2]) {
        item.className = "is-wide";
      }
      var dt = document.createElement("dt");
      dt.textContent = field[1];
      var dd = document.createElement("dd");
      dd.textContent = String(value);
      item.appendChild(dt);
      item.appendChild(dd);
      facts.appendChild(item);
    });
  }
})();
