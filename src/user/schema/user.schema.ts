import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum UserType {
  ADD = 'add',
  UPDATE = 'update',
  INACTIVE = 'inactive',
}

@Schema({ timestamps: true })
export class User {
  //   @Prop({ required: true, enum: UserType })
  //   type: UserType;

  @Prop({ type: Types.ObjectId, ref: 'Account', required: false })
  accountId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Group', required: false })
  groupId?: Types.ObjectId;

  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true })
  firstName: string;

  @Prop()
  middleName?: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  contactNo: string;

  @Prop({ type: Types.ObjectId, ref: 'Role', required: true })
  roleId: Types.ObjectId;

  @Prop({ required: true, enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;
}

export const UserSchema = SchemaFactory.createForClass(User);
