import { Navigate, Route, Routes, useParams } from 'react-router';
import { PublicOnly, RequireAuth, RequireRole } from '@/lib/auth/guards';
import { AdminPage } from '@/features/admin/AdminPage';
import { UsersPage } from '@/features/admin/UsersPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { CultivarFormPage } from '@/features/cultivars/CultivarFormPage';
import { CultivarsPage } from '@/features/cultivars/CultivarsPage';
import { HarvestFormPage } from '@/features/harvests/HarvestFormPage';
import { HarvestPage } from '@/features/harvests/HarvestPage';
import { HarvestsPage } from '@/features/harvests/HarvestsPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { VerifyEmailPage, VerifyEmailSentPage } from '@/features/auth/VerifyEmailPage';
import { FieldDetailPage } from '@/features/fields/FieldDetailPage';
import { FieldFormPage } from '@/features/fields/FieldFormPage';
import { FieldsPage } from '@/features/fields/FieldsPage';
import { PropertiesPage } from '@/features/properties/PropertiesPage';
import { PropertyDetailPage } from '@/features/properties/PropertyDetailPage';
import { PropertyFormPage } from '@/features/properties/PropertyFormPage';
import { Shell } from './layout/Shell';

function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold text-slate-800">Página não encontrada</h1>
    </div>
  );
}

function RedirectToHarvest() {
  const { id } = useParams();
  return <Navigate to={`/safras/${id}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<RegisterPage />} />
        <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
      </Route>
      {/* públicas sem redirecionamento: chegam por link de e-mail */}
      <Route path="/verifique-seu-email" element={<VerifyEmailSentPage />} />
      <Route path="/verificar-email/:token" element={<VerifyEmailPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/propriedades" replace />} />
          <Route path="/propriedades" element={<PropertiesPage />} />
          <Route path="/propriedades/nova" element={<PropertyFormPage />} />
          <Route path="/propriedades/:id" element={<PropertyDetailPage />} />
          <Route path="/propriedades/:id/editar" element={<PropertyFormPage />} />
          <Route path="/propriedades/:id/talhoes/novo" element={<FieldFormPage />} />
          <Route path="/propriedades/:id/talhoes/:fieldId" element={<FieldDetailPage />} />
          <Route path="/propriedades/:id/talhoes/:fieldId/editar" element={<FieldFormPage />} />
          <Route path="/talhoes" element={<FieldsPage />} />
          <Route path="/safras" element={<HarvestsPage />} />
          <Route path="/safras/nova" element={<HarvestFormPage />} />
          <Route path="/safras/:id" element={<HarvestPage />} />
          <Route path="/safras/:id/msa" element={<RedirectToHarvest />} />
          <Route path="/cultivares" element={<CultivarsPage />} />
          <Route path="/cultivares/nova" element={<CultivarFormPage />} />
          <Route path="/cultivares/:id" element={<CultivarFormPage readOnly />} />
          <Route path="/cultivares/:id/editar" element={<CultivarFormPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/usuarios" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
