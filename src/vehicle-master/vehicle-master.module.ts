import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VehicleMasterService } from './vehicle-master.service';
import { VehicleMasterController } from './vehicle-master.controller';
import {
  VehicleMaster,
  VehicleMasterSchema,
} from './schema/vehicle-master.schema';
import { Vehicle, VehicleSchema } from './schema/vehicle.schema';
import { Driver, DriverSchema } from './schema/driver.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VehicleMaster.name, schema: VehicleMasterSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: Driver.name, schema: DriverSchema },
    ]),
  ],
  controllers: [VehicleMasterController],
  providers: [VehicleMasterService],
  exports: [VehicleMasterService],
})
export class VehicleMasterModule {}
