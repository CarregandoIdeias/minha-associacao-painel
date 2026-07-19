-- Migração: adicionar foto (base64) ao cadastro de associado
ALTER TABLE associados ADD COLUMN foto_base64 TEXT;
