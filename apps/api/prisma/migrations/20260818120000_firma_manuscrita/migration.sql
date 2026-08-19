-- Se añade el tipo de firma MANUSCRITA.
--
-- Registrar una firma dibujada es una comodidad, no un requisito: muchos
-- médicos imprimen la receta y la firman a mano, que es un flujo perfectamente
-- válido. Exigir la firma digital para poder emitir bloqueaba ese caso y
-- dejaba al paciente sin su receta por un trámite del médico.
--
-- Distinguirlo importa: permite saber después cómo se firmó cada receta.

ALTER TYPE "SignatureType" ADD VALUE IF NOT EXISTS 'HANDWRITTEN' AFTER 'DRAWN';
