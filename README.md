# Validación de certificados Ferreyros

Sitio estático (HTML/CSS/JS) para validar la autenticidad de certificados Ferreyros mediante un **código QR firmado digitalmente**.

- El QR contiene un enlace del tipo `https://<sitio>/#t=<datos-firmados>.<firma>`.
- La firma es **ECDSA P-256**: la clave privada solo existe en el equipo que emite los QR; el sitio publica únicamente la clave pública (`js/public-key.js`).
- Si alguien ingresa la dirección del sitio manualmente, solo ve "Acceso restringido".
- Si alguien altera un dato del enlace, la firma deja de coincidir y el sitio muestra "No válido".
- Los datos del certificado viajan dentro del QR firmado; el repositorio público **no** contiene datos personales.

## Estructura

| Ruta | Descripción |
|---|---|
| `index.html`, `css/`, `js/`, `assets/` | Sitio publicado |
| `js/public-key.js` | Clave pública (se genera con `npm run claves`) |
| `revocados.json` | Lista de códigos anulados, por ejemplo `["FRY-CAP-2026-0142"]` |
| `tools/emitir.js` | Genera claves y QR firmados |
| `tools/servidor.js` | Servidor local de pruebas |
| `datos/certificados.ejemplo.json` | Formato de datos de ejemplo |
| `.claves/`, `datos/certificados.json`, `salida/` | **No se suben** (ver `.gitignore`) |

## Requisitos

- Node.js 18 o superior
- Git (en Windows: `winget install --id Git.Git -e`, luego cierre y abra la terminal) y una cuenta de GitHub

## 1. Preparar en el equipo local

```powershell
npm install
npm run claves
```

`npm run claves` crea `.claves/privada.pem` (guárdela en un lugar seguro; si se pierde, hay que reemitir todos los QR) y actualiza `js/public-key.js`.

## 2. Subir el sitio a GitHub

1. En GitHub, cree un repositorio nuevo, por ejemplo `validacion-certificados` (sin README).
2. En la carpeta del sitio:

   ```powershell
   git init
   git add .
   git status    # verifique que NO aparezcan .claves/, salida/ ni datos/certificados.json
   git commit -m "Sitio de validación de certificados Ferreyros"
   git branch -M main
   git remote add origin https://github.com/<usuario>/validacion-certificados.git
   git push -u origin main
   ```

3. En GitHub: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main** / **(root)** → **Save**
4. Espere 1–2 minutos. La URL será `https://<usuario>.github.io/validacion-certificados/`.
5. Abra esa URL: debe mostrar "Acceso restringido".

> GitHub Pages en repositorios privados requiere plan de pago (Pro/Team/Enterprise). Con plan gratuito el repositorio debe ser público; por eso el repositorio no contiene datos personales ni la clave privada.

## 3. Generar QR de prueba apuntando a GitHub Pages

```powershell
node tools/emitir.js qr --base https://<usuario>.github.io/validacion-certificados/
```

Genera en `salida/`:

- `qr/<codigo>.png` y `qr/<codigo>.svg`: imágenes para incrustar en el certificado físico.
- `enlaces.csv`: código, participante y URL firmada.
- `certificados.html`: hoja imprimible de prueba con los QR.

Para usar datos reales, copie `datos/certificados.ejemplo.json` a `datos/certificados.json` (ignorado por Git) y edítelo. También puede indicar otro archivo con `--datos ruta.json`. Para que los enlaces venzan, agregue `--dias 730`.

## 4. Probar con el celular

1. Abra `salida/certificados.html` en la PC (doble clic o `npm start` → `http://127.0.0.1:8787/salida/certificados.html`).
2. Escanee un QR con la cámara del celular → debe abrir GitHub Pages con **Certificado válido**.
3. Abra `https://<usuario>.github.io/validacion-certificados/` escribiendo la dirección → **Acceso restringido**.
4. Cambie cualquier carácter del enlace del QR → **No válido**.

## Pruebas locales (sin GitHub)

```powershell
node tools/emitir.js qr --base http://127.0.0.1:8787/
npm start
```

Abra `http://127.0.0.1:8787/salida/certificados.html` y haga clic en un QR. La verificación usa Web Crypto, que el navegador solo habilita en HTTPS o `127.0.0.1`/`localhost`; por eso el celular debe probarse contra GitHub Pages y no contra la IP de la PC.

## Revocar un certificado

Agregue el código a `revocados.json`, haga commit y push. El sitio mostrará "Certificado revocado" para ese QR.

## Dominio propio

Para usar `validacion.ferreyros.com.pe`, configure **Settings → Pages → Custom domain** y un registro DNS `CNAME` hacia `<usuario>.github.io`. Luego reemita los QR con `--base https://validacion.ferreyros.com.pe/`.
