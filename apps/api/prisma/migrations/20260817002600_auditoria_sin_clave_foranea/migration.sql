-- Se quita la clave foránea de AuditLog hacia User.
--
-- Con onDelete: SetNull, borrar un usuario hacía que PostgreSQL intentara
-- ACTUALIZAR las filas de AuditLog, y el trigger de inmutabilidad lo impedía:
-- la cuenta quedaba imposible de borrar. Aflojar el trigger habría sido la
-- solución equivocada, porque el registro no debe poder alterarse nunca.
--
-- Un registro de auditoría no debe depender de las tablas que audita: tiene
-- que sobrevivir a la desaparición de aquello a lo que se refiere. Se guarda
-- además el correo tal como era EN ESE MOMENTO, que es el dato que interesa en
-- una revisión: el usuario pudo cambiar de correo después, y una unión
-- mostraría el actual en lugar del de entonces.

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

ALTER TABLE "AuditLog" ADD COLUMN "userEmail" TEXT;
