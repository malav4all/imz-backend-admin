import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClientDocument = Client & Document;

@Schema({ timestamps: true })
export class Client {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  contactName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  contactNo: string;

  @Prop({ required: true, unique: true })
  panNumber: string;

  @Prop({ required: true, unique: true })
  aadharNumber: string;

  @Prop({ required: true, unique: true })
  gstNumber: string;

  @Prop({ required: true })
  stateName: string;

  @Prop({ required: true })
  cityName: string;

  @Prop()
  remark?: string;

  @Prop({ required: true })
  status: string;
}

export const ClientSchema = SchemaFactory.createForClass(Client);
