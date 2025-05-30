import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpStatus,
  HttpException,
  Res,
  Query,
} from '@nestjs/common';
import { Response } from 'express';
import { DeviceService } from './device.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { ApiResponse } from 'src/comman/api-response';
import { PaginatedResponse, PaginationDto } from 'src/comman/pagination.dto';

@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post()
  async create(
    @Body() createDeviceDto: CreateDeviceDto,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const device = await this.deviceService.create(createDeviceDto);
      const response = ApiResponse.success(
        device,
        'Device created successfully',
        HttpStatus.CREATED,
      );
      return res.status(HttpStatus.CREATED).json(response);
    } catch (error) {
      let message = 'Failed to create device';
      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

      if (error.code === 11000) {
        if (error.message.includes('deviceId')) {
          message = 'Device ID already exists';
        } else if (error.message.includes('modelName')) {
          message = 'Model name already exists';
        } else {
          message = 'Duplicate entry found';
        }
        statusCode = HttpStatus.CONFLICT;
      } else if (error.message.includes('already exists')) {
        message = error.message;
        statusCode = HttpStatus.CONFLICT;
      }

      const response = ApiResponse.error(message, error.message, statusCode);
      return res.status(statusCode).json(response);
    }
  }

  @Get()
  async findAll(
    @Query() paginationDto: PaginationDto,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const { page = 1, limit = 10 } = paginationDto;
      const { devices, total } = await this.deviceService.findAll(page, limit);

      const paginatedResponse = new PaginatedResponse(
        devices,
        page,
        limit,
        total,
      );
      const response = ApiResponse.success(
        paginatedResponse,
        'Devices retrieved successfully',
      );
      return res.status(HttpStatus.OK).json(response);
    } catch (error) {
      const response = ApiResponse.error(
        'Failed to retrieve devices',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
    }
  }

  @Get('search')
  async searchDevices(
    @Query('searchText') searchText: string,
    @Query() paginationDto: PaginationDto,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const { page = 1, limit = 10 } = paginationDto;
      const { devices, total } = await this.deviceService.searchDevices(
        searchText,
        page,
        limit,
      );

      const paginatedResponse = new PaginatedResponse(
        devices,
        page,
        limit,
        total,
      );
      const response = ApiResponse.success(
        paginatedResponse,
        'Devices retrieved successfully',
      );
      return res.status(HttpStatus.OK).json(response);
    } catch (error) {
      const response = ApiResponse.error(
        'Failed to search devices',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
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

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const device = await this.deviceService.findOne(id);
      if (!device) {
        const response = ApiResponse.error(
          'Device not found',
          'No device found with the provided ID',
          HttpStatus.NOT_FOUND,
        );
        return res.status(HttpStatus.NOT_FOUND).json(response);
      }

      const response = ApiResponse.success(
        device,
        'Device retrieved successfully',
      );
      return res.status(HttpStatus.OK).json(response);
    } catch (error) {
      const response = ApiResponse.error(
        'Failed to retrieve device',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
    }
  }

  @Get('device-id/:deviceId')
  async findByDeviceId(
    @Param('deviceId') deviceId: string,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const device = await this.deviceService.findByDeviceId(deviceId);
      if (!device) {
        const response = ApiResponse.error(
          'Device not found',
          'No device found with the provided device ID',
          HttpStatus.NOT_FOUND,
        );
        return res.status(HttpStatus.NOT_FOUND).json(response);
      }

      const response = ApiResponse.success(
        device,
        'Device retrieved successfully',
      );
      return res.status(HttpStatus.OK).json(response);
    } catch (error) {
      const response = ApiResponse.error(
        'Failed to retrieve device',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
    }
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDeviceDto: Partial<CreateDeviceDto>,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const device = await this.deviceService.update(id, updateDeviceDto);
      if (!device) {
        const response = ApiResponse.error(
          'Device not found',
          'No device found with the provided ID',
          HttpStatus.NOT_FOUND,
        );
        return res.status(HttpStatus.NOT_FOUND).json(response);
      }

      const response = ApiResponse.success(
        device,
        'Device updated successfully',
      );
      return res.status(HttpStatus.OK).json(response);
    } catch (error) {
      let message = 'Failed to update device';
      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

      if (error.code === 11000) {
        message = 'Device ID already exists';
        statusCode = HttpStatus.CONFLICT;
      }

      const response = ApiResponse.error(message, error.message, statusCode);
      return res.status(statusCode).json(response);
    }
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      const result = await this.deviceService.remove(id);
      if (!result) {
        const response = ApiResponse.error(
          'Device not found',
          'No device found with the provided ID',
          HttpStatus.NOT_FOUND,
        );
        return res.status(HttpStatus.NOT_FOUND).json(response);
      }

      const response = ApiResponse.success(null, 'Device deleted successfully');
      return res.status(HttpStatus.OK).json(response);
    } catch (error) {
      const response = ApiResponse.error(
        'Failed to delete device',
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
    }
  }
}
