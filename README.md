# A un paso delivery

PWA de gestión de pedidos para motorizados, soporte y administración. La aplicación es estática y se publica en GitHub Pages; Supabase proporciona autenticación, base de datos, RLS y actualizaciones en tiempo real.

## Configuración de Supabase

1. En el proyecto `ibclzcikkxhdnorcbfoe`, abre **SQL Editor** y ejecuta `supabase/schema.sql`.
2. En **Authentication → Providers → Email**, desactiva **Confirm email** antes de registrar usuarios. La interfaz pide usuario y contraseña, no correo: internamente utiliza un alias técnico `usuario@users.aunpaso.local` para el proveedor de contraseña de Supabase.
3. Registra la cuenta que será la primera administradora. En SQL Editor, asígnale el rol:

   ```sql
   update public.profiles
   set role = 'administracion', approved = true
   where username = 'tu_usuario';
   ```

4. Inicia sesión como administración. Aprueba las demás cuentas asignándoles el rol correspondiente. Las cuentas nuevas empiezan sin rol y sin acceso. Crea los aliados comerciales en **Aliados**.
5. Revisa **Authentication → URL Configuration** y agrega la URL publicada en GitHub Pages a las URLs permitidas.

La URL del proyecto y la clave `anon`/publishable son públicas por diseño y están en `app.js`. La seguridad de los datos está en las políticas RLS y las funciones SQL. **No añadas nunca la `service_role` key al frontend ni al repositorio.**

## Publicar en GitHub Pages

El workflow `.github/workflows/deploy.yml` publica la raíz del repositorio al hacer push a `main`. En GitHub, abre **Settings → Pages** y selecciona **GitHub Actions** como origen. También puedes publicar manualmente la raíz del repositorio desde Pages si no deseas usar el workflow.

Para probar localmente, sirve esta carpeta con un servidor HTTP local; abrir `index.html` directamente como `file://` no permite instalar el service worker ni cargar correctamente los módulos.

## Funcionalidades incluidas

- Registro sin correo, inicio de sesión por usuario, aprobación y roles.
- Pedidos, asignaciones atómicas y estados con hora de llegada al comercio, salida y entrega.
- Disponibilidad de motorizados con heartbeat y conteo de actividad reciente.
- Gestión de usuarios, suspensión/eliminación de acceso, aliados, métricas e historial.
- Exportación del reporte de entregas en formato Excel XML `.xls`.
- Diseño adaptable, manifest y service worker instalable.

Los cambios de pedidos y disponibilidad se reflejan mediante Supabase Realtime, con actualización periódica de respaldo mientras la sesión está abierta.
