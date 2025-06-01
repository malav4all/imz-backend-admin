import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoleDocument = Role & Document;

export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  ADMIN_ASSISTANT = 'ADMIN_ASSISTANT',
  USER = 'USER',
}

export enum Permission {
  VIEW = 'VIEW',
  ADD = 'ADD',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXPORT = 'EXPORT',
}

export enum Module {
  USER = 'USER',
  ROLE = 'ROLE',
  PRODUCT = 'PRODUCT',
  ORDER = 'ORDER',
  REPORT = 'REPORT',
  SETTINGS = 'SETTINGS',
}

export interface ModulePermission {
  module: Module;
  permissions: Permission[];
}

@Schema({ timestamps: true })
export class Role {
  @Prop({ required: true, unique: true, enum: UserRole })
  name: UserRole;

  @Prop({ required: true })
  displayName: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: [{ module: String, permissions: [String] }], required: true })
  modulePermissions: ModulePermission[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isSystem: boolean; // System roles cannot be deleted
}

export const RoleSchema = SchemaFactory.createForClass(Role);
