# Validación de certificados Ferreyros

Sitio estático (HTML/CSS/JS) para validar la autenticidad de certificados Ferreyros mediante un **código QR** impreso en el certificado físico.

- El QR abre una URL corta: `https://<sitio>/certificaciones/BT3WVAPC`.
- El código tiene **8 caracteres** (letras mayúsculas y dígitos, sin 0/O/1/I para evitar confusiones). Hay ~1 billón de combinaciones, por lo que no es práctico adivinarlo.
- `https://<sitio>/` y `https://<sitio>/certificaciones/` redirigen a https://www.ferreyros.com.pe/.
- Cada certificado se publica **cifrado** (AES-256-GCM) en `registros/`. El nombre del archivo y la clave se derivan del código con PBKDF2, así que sin el código el repositorio solo contiene archivos ilegibles.

## Estructura

| Ruta | Descripción |
|---|---|
| `index.html`, `certificaciones/index.html` | Redirigen a ferreyros.com.pe |
| `404.html` | Página de validación (GitHub Pages la sirve para `/certificaciones/<CODIGO>`) |
| `css/`, `js/`, `assets/` | Estilos, scripts, logo y carrusel |
| `registros/` | Registros cifrados (se publican) |
| `revocados.json` | Certificados anulados, por ejemplo `["FRY-CAP-2026-0142"]` |
| `tools/emitir.js` | Genera códigos, registros cifrados y QR |
| `tools/servidor.js` | Servidor local que imita a GitHub Pages |
| `datos/certificados.ejemplo.json` | Formato de datos |
| `.claves/`, `datos/certificados.json`, `salida/` | **No se suben** (ver `.gitignore`) |

## Requisitos

- Node.js 18 o superior
- Git (en Windows: `winget install --id Git.Git -e`) y una cuenta de GitHub

## 1. Preparar (una sola vez)

```powershell
npm install
npm run secreto
```

`.claves/secreto.key` determina los códigos de 8 caracteres: el mismo certificado siempre obtiene el mismo código. **Respáldelo.** Si se pierde o se cambia, los códigos de los certificados ya impresos ya no se podrán regenerar.

## 2. Emitir certificados

```powershell
# Todos los certificados del archivo de datos
node tools/emitir.js qr --base https://evillanuevaj.github.io/academicoii/

# Solo uno
node tools/emitir.js qr --base https://evillanuevaj.github.io/academicoii/ --solo FRY-CAP-2026-0142

# Solo los primeros N
node tools/emitir.js qr --base https://evillanuevaj.github.io/academicoii/ --limite 1
```

Genera:

- `registros/<id>.json`: registro cifrado, **debe subirse a GitHub**.
- `salida/qr/<codigo>.png` y `.svg`: QR para el certificado físico.
- `salida/enlaces.csv`: N.º de certificado, participante, código de verificación y URL.
- `salida/certificados.html`: hoja imprimible de prueba.

Use `datos/certificados.json` (ignorado por Git) para datos reales, o indique otro archivo con `--datos ruta.json`. Con `--dias 730` la verificación vence a los 2 años.

### Formato de datos

Cada certificado lleva `apellidos` y `nombres` por separado; el sitio muestra **"APELLIDOS, Nombres"** (por ejemplo `TONGO VILLANUEVA, Juan Luis`). También se acepta `"participante": "Apellidos, Nombres"` con coma. Fechas en `dd/mm/aaaa`, documento como `DNI ****1234`.

Antes de emitir, el script valida todos los datos y **no genera nada si hay errores**: campos faltantes, códigos duplicados o con formato distinto a `FRY-XXX-AAAA-NNNN`, fechas inválidas o fuera de orden, horas no numéricas, caracteres no válidos en nombres y palabras sin tilde en tipo/programa/línea/sede. Los nombres que suelen llevar tilde (Jesús, Vásquez…) solo generan un aviso, porque deben coincidir con el DNI. Para revisar sin generar:

```powershell
node tools/emitir.js validar
```

## 3. Publicar en GitHub Pages

```powershell
git add .
git status    # NO deben aparecer .claves/, salida/ ni datos/certificados.json
git commit -m "Publicar certificados"
git push
```

Configuración inicial: **Settings → Pages → Deploy from a branch → main / (root)**.

## 4. Probar

| URL | Resultado |
|---|---|
| `https://<sitio>/certificaciones/<CODIGO>` | Certificado válido |
| `https://<sitio>/certificaciones/ZZZZZZZZ` | Certificado no encontrado |
| `https://<sitio>/` o `/certificaciones/` | Redirige a ferreyros.com.pe |

Pruebas locales:

```powershell
npm start
```

Abra `http://127.0.0.1:8787/certificaciones/<CODIGO>` o `http://127.0.0.1:8787/salida/certificados.html`.

## Revocar un certificado

Agregue el N.º de certificado a `revocados.json`, haga commit y push.

## Dominio propio

Para usar `https://www.dominio.com.pe/certificaciones/<CODIGO>`, configure **Settings → Pages → Custom domain** con el DNS correspondiente y reemita los QR con `--base https://www.dominio.com.pe/`. Los códigos y registros no cambian; solo cambia la URL dentro del QR.
