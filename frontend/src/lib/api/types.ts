/** Espelho das respostas da API (backend/src/modules/*). */
import type { Point, Polygon } from 'geojson';

export type Role = 'ADMIN' | 'AGRONOMO' | 'PRODUTOR';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  AGRONOMO: 'Agrônomo',
  PRODUTOR: 'Produtor',
};

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export interface UserDirectoryEntry extends UserSummary {
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: PublicUser;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  role: Exclude<Role, 'ADMIN'>;
  personType: 'PF' | 'PJ';
  cpf?: string;
  cnpj?: string;
  crea?: string;
  phone?: string;
}

export interface PropertyResponse {
  id: string;
  name: string;
  state: string;
  city: string;
  car: string | null;
  nirf: string | null;
  ownerId: string;
  agronomistId: string | null;
  owner: UserSummary;
  agronomist: UserSummary | null;
  fieldsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyPayload {
  name: string;
  state: string;
  city: string;
  car?: string;
  nirf?: string;
  ownerId?: string;
}

export interface FieldResponse {
  id: string;
  name: string;
  propertyId: string;
  areaHa: number;
  geometry: Polygon;
  centroid: Point;
  soilType: string | null;
  notes: string | null;
  altitudeM: number | null;
  thetaFC: number | null;
  thetaWP: number | null;
  era5Cell: { lat: number; lon: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface FieldPayload {
  name: string;
  geometry?: Polygon;
  areaHa?: number;
  soilType?: string;
  notes?: string;
  altitudeM?: number;
  thetaFC?: number;
  thetaWP?: number;
}

export interface QueueCounts {
  queues: Record<string, Record<string, number>>;
  weekly: { nextRun: string | null; pattern: string | null; tz: string | null };
}
