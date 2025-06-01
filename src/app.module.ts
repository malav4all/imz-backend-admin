import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DeviceModule } from './device/device.module';
import { VehicleModule } from './vechile/vechile.module';
import { ClientModule } from './client/client.module';
import { DriverModule } from './driver/driver.module';
import { VehicleMasterModule } from './vehicle-master/vehicle-master.module';
import { AccountModule } from './account/account.module';
import { RoleModule } from './role/role.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env`,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async () => ({
        uri: process.env.DB_URL,
      }),
    }),
    DeviceModule,
    VehicleModule,
    ClientModule,
    DriverModule,
    VehicleMasterModule,
    AccountModule,
    RoleModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
