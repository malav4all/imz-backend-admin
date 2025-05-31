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
  Res,
} from '@nestjs/common';
import { VehicleMasterService } from './vehicle-master.service';
import { UpdateVehicleMasterDto } from './dto/update-vehicle-master.dto';
import { SearchVehicleMasterDto } from './dto/search-vehicle-master.dto';
import { CreateVehicleMasterDto } from './dto/create-vehcile-master.dto';
import { ApiResponse } from 'src/comman/api-response';
import { Response } from 'express';

@Controller('vehicle-masters')
export class VehicleMasterController {
  constructor(private readonly vehicleMasterService: VehicleMasterService) {}

  @Post()
  async create(@Body() createVehicleMasterDto: CreateVehicleMasterDto) {
    try {
      const vehicleMaster = await this.vehicleMasterService.create(
        createVehicleMasterDto,
      );
      return ApiResponse.success(
        vehicleMaster,
        'Vehicle Master created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.name,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  async findAll(@Query() searchDto: SearchVehicleMasterDto) {
    try {
      const result = await this.vehicleMasterService.findAll(searchDto);
      return ApiResponse.success(
        result,
        'Vehicle Masters retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.name,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('search')
  async search(@Query() searchDto: SearchVehicleMasterDto) {
    try {
      const result = await this.vehicleMasterService.findAll(searchDto);
      return ApiResponse.success(
        result,
        'Vehicle Masters retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.name,
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
      const devices = await this.vehicleMasterService.findAllForExport();

      switch (format) {
        case 'csv':
          return this.vehicleMasterService.exportToCSV(devices, res);
        case 'xlsx':
          return this.vehicleMasterService.exportToXLSX(devices, res);
        case 'pdf':
          return this.vehicleMasterService.exportToPDF(devices, res);
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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const vehicleMaster = await this.vehicleMasterService.findOne(id);
      return ApiResponse.success(
        vehicleMaster,
        'Vehicle Master retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.name,
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateVehicleMasterDto: UpdateVehicleMasterDto,
  ) {
    try {
      const vehicleMaster = await this.vehicleMasterService.update(
        id,
        updateVehicleMasterDto,
      );
      return ApiResponse.success(
        vehicleMaster,
        'Vehicle Master updated successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.name,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.vehicleMasterService.remove(id);
      return ApiResponse.success(null, 'Vehicle Master deleted successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.name,
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }
}
