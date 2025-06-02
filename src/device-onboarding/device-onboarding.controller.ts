import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  Put,
  Res,
} from '@nestjs/common';
import { DeviceOnboardingService } from './device-onboarding.service';
import { CreateDeviceOnboardingDto } from './dto/create-device-onboarding.dto';
import { ApiResponse } from 'src/comman/api-response';
import { DeviceOnboardingQueryDto } from './dto/device-onboaring-query.dto';
import { UpdateDeviceOnboardingDto } from './dto/update-device-onboarding.dto';
import { Response } from 'express';

@Controller('devices-onboarding')
export class DeviceOnboardingController {
  constructor(private readonly deviceService: DeviceOnboardingService) {}

  @Post()
  async create(@Body() createDeviceDto: CreateDeviceOnboardingDto) {
    try {
      const device = await this.deviceService.create(createDeviceDto);
      return ApiResponse.success(
        device,
        'Device created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to create device',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  async findAll(@Query() query: DeviceOnboardingQueryDto) {
    try {
      const result = await this.deviceService.findAll(query);
      return ApiResponse.success(result, 'Devices retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve devices',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('search')
  async searchDeviceOnboardings(
    @Query('search') search: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    try {
      const result = this.deviceService.search(
        search,
        Number(page),
        Number(limit),
      );
      return ApiResponse.success(result, 'Devices retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve devices',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('export')
  async exportDevices(
    @Query('format') format: 'pdf' | 'xlsx' | 'csv',
    @Res() res: Response,
  ): Promise<any> {
    try {
      const devices = await this.deviceService.findAllWithoutPagination();

      switch (format) {
        case 'csv':
          return this.deviceService.exportToCSV(devices, res);
        case 'xlsx':
          return this.deviceService.exportToXLSX(devices, res);
        case 'pdf':
          return this.deviceService.exportToPDF(devices, res);
        default:
          return res
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: 'Invalid format' });
      }
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to export devices',
        error: error.message,
      });
    }
  }

  @Get('stats')
  async getStats() {
    try {
      const stats = await this.deviceService.getDeviceStats();
      return ApiResponse.success(
        stats,
        'Device statistics retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve device statistics',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('account/:accountId')
  async getDevicesByAccount(@Param('accountId') accountId: string) {
    try {
      const devices = await this.deviceService.getDevicesByAccount(accountId);
      return ApiResponse.success(
        devices,
        'Account devices retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve account devices',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('vehicle/:vehicleId')
  async getDevicesByVehicle(@Param('vehicleId') vehicleId: string) {
    try {
      const devices = await this.deviceService.getDevicesByVehicle(vehicleId);
      return ApiResponse.success(
        devices,
        'Vehicle devices retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve vehicle devices',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const device = await this.deviceService.findOne(id);
      return ApiResponse.success(device, 'Device retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to retrieve device',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDeviceDto: UpdateDeviceOnboardingDto,
  ) {
    try {
      const device = await this.deviceService.update(id, updateDeviceDto);
      return ApiResponse.success(device, 'Device updated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to update device',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    try {
      const device = await this.deviceService.deactivate(id);
      return ApiResponse.success(device, 'Device deactivated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to deactivate device',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put(':id/activate')
  async activate(@Param('id') id: string) {
    try {
      const device = await this.deviceService.activate(id);
      return ApiResponse.success(device, 'Device activated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to activate device',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.deviceService.remove(id);
      return ApiResponse.success(null, 'Device deleted successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message || 'Failed to delete device',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }
}
