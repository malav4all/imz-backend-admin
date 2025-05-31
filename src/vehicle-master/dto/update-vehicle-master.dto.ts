import { PartialType } from '@nestjs/mapped-types';
import { CreateVehicleMasterDto } from './create-vehcile-master.dto';

export class UpdateVehicleMasterDto extends PartialType(
  CreateVehicleMasterDto,
) {}
