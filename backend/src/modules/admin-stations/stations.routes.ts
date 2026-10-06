import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { AppError } from '../../utils/app-error';
import { stationsController } from './stations.controller';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.csv', '.txt']);

/** Arquivo gravado no volume compartilhado `station_imports`; o ETL lê o mesmo caminho. */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Diretório e arquivos legíveis/removíveis pelo usuário não-root do contêiner etl (uid diferente).
    fs.mkdirSync(env.STATION_IMPORTS_DIR, { recursive: true, mode: 0o777 });
    cb(null, env.STATION_IMPORTS_DIR);
  },
  filename: (_req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    cb(null, `${randomUUID()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new AppError(400, 'INVALID_FILE', 'Envie um arquivo .csv ou .txt.'));
    cb(null, true);
  },
});

/** /api/v1/admin/stations — estações meteorológicas e observações (ADMIN). */
export const stationsRoutes = Router();

stationsRoutes.use(authenticate, authorize('ADMIN'));
stationsRoutes.get('/', stationsController.list);
// `/upload` no fim do caminho cai na zona api_upload do nginx.prod.conf
stationsRoutes.post('/upload', upload.single('file'), stationsController.upload);
