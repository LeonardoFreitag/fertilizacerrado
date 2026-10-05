import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Definido pelo middleware authenticate. */
      user?: {
        id: string;
        role: Role;
      };
    }
  }
}

export {};
