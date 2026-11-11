# A un paso delivery

## APK Android con GPS en segundo plano

El proyecto incluye Capacitor y `@capacitor-community/background-geolocation`. La APK carga la PWA publicada en GitHub Pages y activa un servicio Android de ubicación mientras el motorizado está en ON. Al cambiar a OFF o cerrar sesión, el watcher nativo se elimina.

Android muestra una notificación persistente mientras comparte la ubicación. Es necesario conceder ubicación precisa, ubicación mientras la app está en segundo plano y desactivar optimización de batería para esta aplicación si el fabricante lo solicita. La compilación automática está en `.github/workflows/android-apk.yml`; ejecuta **Build Android APK** desde GitHub Actions y descarga el artefacto `aunpaso-debug-apk` cuando termine.

Comandos locales opcionales:

```powershell
npm install
npx cap sync android
npx cap open android
```

PWA de gestión de pedidos para motorizados, aliados, soporte y administración. La aplicación es estática y se publica en GitHub Pages; Supabase proporciona autenticación, base de datos, RLS y actualizaciones en tiempo real.

## Configuración de Supabase

1. En el proyecto `ibclzcikkxhdnorcbfoe`, abre **SQL Editor** y ejecuta `supabase/schema.sql`. Vuelve a ejecutarlo para aplicar el rol cliente, KYC, solicitudes, políticas de Storage y las funciones de revisión; el esquema está preparado para volver a ejecutarse. La política de pedidos usa una función segura para comprobar pedidos en curso y evitar recursión de RLS.
2. En **Authentication → Providers → Email**, desactiva **Confirm email** antes de registrar usuarios. La interfaz pide usuario y contraseña, no correo: internamente utiliza un alias técnico `usuario@users.aunpaso.local` para el proveedor de contraseña de Supabase.
3. Registra la cuenta que será la primera administradora. En SQL Editor, asígnale el rol:

   ```sql
   update public.profiles
   set role = 'administracion', approved = true
   where username = 'tu_usuario';
   ```

4. Inicia sesión como administración. Crea los aliados comerciales y su URL GPS en **Aliados**. Las cuentas que se registren desde la app empiezan como clientes aprobados, pero no pueden pedir servicios hasta verificar su identidad. En **Usuarios**, administración puede asignar roles internos y, para cuentas **Aliado**, el comercio asociado.
5. Revisa **Authentication → URL Configuration** y agrega la URL publicada en GitHub Pages a las URLs permitidas.

La URL del proyecto y la clave `anon`/publishable son públicas por diseño y están en `app.js`. La seguridad de los datos está en las políticas RLS y las funciones SQL. **No añadas nunca la `service_role` key al frontend ni al repositorio.**

## KYC, clientes y Google Maps

1. En Google Cloud habilita **Places API (New)** y **Routes API**, configura facturación y crea una clave restringida a esas APIs. No pongas esa clave en `app.js`, en GitHub ni en variables públicas de GitHub Pages.
2. Guarda la clave como secreto de Edge Function en Supabase (por ejemplo, con `supabase secrets set GOOGLE_MAPS_API_KEY=...`). El runtime de Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`; nunca expongas la clave de servicio.
3. Despliega `customer-services` y `admin-delete-user` con `supabase functions deploy customer-services` y `supabase functions deploy admin-delete-user`. La app usa Places para buscar lugares y Routes para medir distancia vehicular; sin `GOOGLE_MAPS_API_KEY` las búsquedas y tarifas no estarán disponibles. Si aparece un error de conexión con `customer-services`, confirma que la función esté desplegada y revisa sus registros en **Edge Functions → Logs**; no agregues la clave de Google al frontend.
4. Los mapas permiten usar GPS para la recogida y mover manualmente ambos pines. Traslados: Express USD 0,45/km y Económico USD 0,35/km; el cálculo y la tarifa se verifican en el servidor. Las solicitudes de encomienda, compra y delivery quedan privadas hasta que soporte las cotice y libere o asigne.
5. Las fotos de rostro, cédula y documentos de aspirantes se cargan en los buckets privados `customer-kyc` y `applicant-documents`. Ejecuta el esquema SQL antes de aceptar documentos y conserva las políticas RLS de Storage. Administración aprueba o rechaza KYC en **Verificaciones** y postulaciones en **Aspirantes**; la foto de rostro verificada se usa como avatar mediante un enlace firmado temporal. Al eliminar un usuario desde la app, `admin-delete-user` también borra sus documentos privados antes de quitar la cuenta.

La revisión KYC es manual: esta versión almacena las fotos y permite que administración las revise, pero no implementa comparación biométrica automatizada, prueba de vida ni verificación OTP del teléfono. Limita quién tiene acceso administrativo y revisa las obligaciones de privacidad y retención aplicables a documentos de identidad.

## Notificaciones push en Android

Las alarmas de audio dentro de la app no llegan si Android la cierra. Para notificaciones remotas:

1. Crea una app Android en Firebase con el ID `delivery.aunpaso.app`, habilita Cloud Messaging y descarga `google-services.json`.
2. Convierte el archivo a Base64 localmente con PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("google-services.json"))`. Guarda el resultado como Actions secret `GOOGLE_SERVICES_JSON_BASE64` en GitHub. El workflow crea `android/app/google-services.json` durante la compilación; el archivo se ignora en Git.
3. En Supabase, ejecuta de nuevo `supabase/schema.sql`. Esto crea el registro privado de tokens y la cola de eventos para pedidos.
4. Crea una cuenta de servicio en Google Cloud con permiso para enviar Firebase Cloud Messaging. En la terminal, enlaza Supabase con `supabase link --project-ref ibclzcikkxhdnorcbfoe` y despliega con `supabase functions deploy send-courier-push --no-verify-jwt`. En **Edge Functions → Secrets**, guarda `FCM_SERVICE_ACCOUNT_JSON` (contenido JSON de la cuenta de servicio) y `PUSH_WEBHOOK_SECRET` (secreto aleatorio compartido con el webhook). Supabase proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; nunca copies la clave privada de Firebase ni la clave de servicio de Supabase al frontend o a GitHub.
5. En **Database → Webhooks**, crea un webhook para `INSERT` en `public.courier_push_outbox`, hacia `https://ibclzcikkxhdnorcbfoe.supabase.co/functions/v1/send-courier-push`. Añade el header `x-push-webhook-secret` con el mismo `PUSH_WEBHOOK_SECRET`. Si la función ya estaba desplegada, vuelve a desplegarla para aplicar los avisos a motorizados con ON incluso cuando la app está cerrada.
6. Genera e instala una APK nueva. El motorizado debe iniciar sesión, pulsar **Activar alertas** y permitir notificaciones. Los tokens quedan asociados al usuario; pedidos asignados/reasignados se envían a su motorizado y pedidos disponibles a los motorizados con ON y un token registrado. OFF deja de recibir avisos. Los traslados se notifican a motorizados sin servicios activos, y al finalizar un servicio se envía de nuevo el aviso de la solicitud en espera.

La app muestra una notificación del sistema con un sonido por evento cuando está en segundo plano. Android puede impedir avisos si el usuario fuerza la detención, revoca permisos o restringe la app por batería. La PWA web no se registra para FCM con esta implementación.

## Publicar en GitHub Pages

El workflow `.github/workflows/deploy.yml` publica la raíz del repositorio al hacer push a `main`. En GitHub, abre **Settings → Pages** y selecciona **GitHub Actions** como origen. Usa este workflow para que cada despliegue marque el service worker con una versión única. Si publicas manualmente, cambia `BUILD_VERSION` en `sw.js` en cada publicación.

Para probar localmente, sirve esta carpeta con un servidor HTTP local; abrir `index.html` directamente como `file://` no permite instalar el service worker ni cargar correctamente los módulos.

## Funcionalidades incluidas

- Registro sin correo, inicio de sesión por usuario, aprobación y roles.
- Pedidos, asignaciones atómicas y estados con hora de llegada al comercio, salida y entrega.
- Disponibilidad de motorizados con heartbeat y conteo de actividad reciente.
- Monitoreo en mapa para soporte y administración, con ubicaciones GPS recientes de motorizados activos.
- Alertas para motorizados con el archivo de sonido de pedido incluido, y alarma de retraso con el archivo de alarma incluido; vibración opcional según soporte del dispositivo.
- Gestión de usuarios, suspensión/eliminación de acceso, aliados, métricas e historial.
- Reportes de entregas filtrables por fechas, motorizado y aliado, con exportación Excel XML `.xls` que conserva los filtros aplicados; métricas operativas diarias de entregas y tiempos de aceptación/entrega.
- Portal cliente con perfil KYC, solicitudes de traslado/encomienda/compra/delivery, búsqueda de lugares, ubicación GPS, pins ajustables e historial; revisión de verificaciones y aspirantes en administración.
- Diseño adaptable, manifest y service worker instalable.

Los cambios de pedidos, disponibilidad y ubicaciones se reflejan mediante Supabase Realtime, con actualización periódica de respaldo mientras la sesión está abierta. En **Monitoreo**, soporte y administración ven un mapa de Leaflet/OpenStreetMap y las posiciones GPS recientes de motorizados activos; Leaflet y las teselas del mapa se cargan desde internet al abrir esa sección. Los motorizados deben activar **ON** y permitir acceso a la ubicación del navegador. La app envía una posición como máximo cada 15 segundos mientras esté en línea; al pasar a **OFF** o cerrar sesión, detiene el GPS y elimina la posición guardada. La base de datos solo permite leer posiciones recientes a soporte y administración; se ocultan posiciones de más de 90 segundos. La PWA intenta mantener el seguimiento activo mientras está abierta, solicita ubicaciones periódicamente e intenta mantener la pantalla encendida con Wake Lock cuando el navegador lo permite. Android puede suspenderla en segundo plano; el seguimiento continuo con la pantalla apagada o la app cerrada requiere una aplicación Android nativa con servicio de ubicación. Ejecuta nuevamente `supabase/schema.sql` para crear la tabla protegida de ubicaciones y habilitar Realtime antes de publicar esta función.

En **Motorizados activos**, soporte y administración ven si cada motorizado está disponible u ocupado y los pedidos que tiene asignados en curso. Un aliado solo ve sus pedidos; se crean en una cola privada hasta que soporte los libera o asigna. Soporte puede liberar o reasignar un pedido que aún no ha llegado al comercio; el plazo de 10 minutos continúa desde la asignación inicial y la comanda deja de estar asociada al motorizado anterior. Tras la llegada al comercio no se puede reasignar. Al iniciar sesión, a los motorizados se les muestra el botón destacado **Activar alertas** y a soporte/administración **Activar alarma**; deben pulsarlo para habilitar el audio en ese dispositivo. El primero reproduce `email-notification-message-ring.wav` para pedidos entrantes o asignados y vibra si el dispositivo lo permite. El segundo habilita `classic-danger-alarm.mp3` cuando un pedido supera los 10 minutos. El audio intrapágina no usa notificaciones del sistema; en Android, además, los avisos push de pedidos asignados o disponibles se entregan mediante Firebase Cloud Messaging cuando la app está en segundo plano y el sistema lo permite. Los navegadores móviles exigen interacción del usuario para permitir audio; el botón no se puede activar automáticamente sin una acción, y el sitio no puede forzar sonido si el sistema está silenciado o la página quedó suspendida en segundo plano. Los dos archivos se incluyen y precargan con la PWA. El motorizado ve el 70% de ganancia con hasta dos decimales, puede copiar el teléfono, contactar por WhatsApp y abrir el GPS del comercio. El creador queda guardado como dato histórico en las comandas e informes.

## Actualizaciones automáticas instaladas

En cada despliegue de GitHub Actions se marca el service worker con el commit publicado y se precargan los archivos de esa versión evitando respuestas antiguas de la caché HTTP. Las PWA abiertas comprueban actualizaciones al cargarse, al volver a primer plano y cada 30 minutos. Cuando la nueva versión toma control, la página se recarga automáticamente; si soporte está escribiendo un pedido, espera a que lo envíe o salga del formulario antes de recargar. La actualización requiere conexión a internet y que GitHub Pages haya terminado el despliegue. El navegador puede tardar un poco en detectar un despliegue mientras la app está cerrada; al abrir o traer la PWA a primer plano vuelve a comprobarlo.

La PWA no bloquea las herramientas de desarrollo del navegador: eso no protege el código ni los datos, que deben protegerse en Supabase con Auth, RLS y validación de permisos. Las actualizaciones en segundo plano no reemplazan el formulario de creación mientras está abierto, para evitar perder lo que se está escribiendo.

Los motorizados deben pulsar **Activar alertas** al entrar a la PWA y soporte/administración **Activar alarma** para habilitar sus audios durante esa sesión. La vibración depende de que el navegador/dispositivo soporte la API y de los ajustes del teléfono. El audio funciona dentro de la PWA abierta y conectada; los avisos push nativos están disponibles en Android una vez configurados Firebase, el webhook y los permisos descritos arriba. La PWA web no se registra para FCM.
