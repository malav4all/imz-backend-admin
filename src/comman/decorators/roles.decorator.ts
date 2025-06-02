import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata('permissions', permissions);
