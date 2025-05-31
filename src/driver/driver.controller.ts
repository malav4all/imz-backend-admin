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
  ValidationPipe,
  UsePipes,
  Res,
} from '@nestjs/common';
import { DriverService } from './driver.service';
import {
  CreateDriverDto,
  SearchDriverDto,
  UpdateDriverDto,
} from './dto/create-driver.dto';
import { ApiResponse } from 'src/comman/api-response';
import { Response } from 'express';

@Controller('drivers')
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async create(@Body() createDriverDto: CreateDriverDto) {
    try {
      const driver = await this.driverService.create(createDriverDto);
      return ApiResponse.success(
        driver,
        'Driver created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(@Query() searchDto: SearchDriverDto) {
    try {
      const result = await this.driverService.findAll(searchDto);
      return ApiResponse.success(result, 'Drivers retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('export')
  async exportDrivers(
    @Query('format') format: 'pdf' | 'xlsx' | 'csv',
    @Res() res: Response,
  ): Promise<any> {
    try {
      const drivers = await this.driverService.findAllWithoutPagination();

      switch (format) {
        case 'csv':
          return this.driverService.exportToCSV(drivers, res);
        case 'xlsx':
          return this.driverService.exportToXLSX(drivers, res);
        case 'pdf':
          return this.driverService.exportToPDF(drivers, res);
        default:
          return res
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: 'Invalid format. Use pdf, xlsx, or csv.' });
      }
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to export drivers',
        error: error.message,
      });
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const driver = await this.driverService.findOne(id);
      return ApiResponse.success(driver, 'Driver retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async update(
    @Param('id') id: string,
    @Body() updateDriverDto: UpdateDriverDto,
  ) {
    try {
      const driver = await this.driverService.update(id, updateDriverDto);
      return ApiResponse.success(driver, 'Driver updated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.driverService.remove(id);
      return ApiResponse.success(null, 'Driver deleted successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }
}
