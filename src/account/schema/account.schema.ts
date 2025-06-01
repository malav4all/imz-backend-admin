// account.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AccountDocument = Account & Document;

@Schema({ timestamps: true })
export class Account {
  @Prop({ required: true })
  accountName: string;

  @Prop({ type: Types.ObjectId, ref: 'Account', default: null })
  parentAccount: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  clientId: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  level: number;

  @Prop({ required: true })
  hierarchyPath: string; // e.g., "1", "1.2", "1.2.3"

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Account' }], default: [] })
  children: Types.ObjectId[];
}

export const AccountSchema = SchemaFactory.createForClass(Account);
