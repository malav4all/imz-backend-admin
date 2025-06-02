import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true, trim: true })
  groupName: string;

  @Prop({ required: true, trim: true })
  groupType: string;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'DeviceOnboarding' }],
    required: true,
  })
  imei: Types.ObjectId[];

  @Prop({ required: true, trim: true })
  stateName: string;

  @Prop({ required: true, trim: true })
  cityName: string;

  @Prop({ trim: true })
  remark?: string;

  @Prop({ required: true, trim: true })
  contactNo: string;

  @Prop({})
  status: string;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
