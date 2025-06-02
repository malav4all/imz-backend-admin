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
  Res,
} from '@nestjs/common';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupQueryDto } from './dto/group-query.dto';
import { GroupsService } from './group.service';
import { ApiResponse } from 'src/comman/api-response';
import { Response } from 'express';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  async create(@Body(ValidationPipe) createGroupDto: CreateGroupDto) {
    try {
      const group = await this.groupsService.create(createGroupDto);
      return ApiResponse.success(
        group,
        'Group created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      return ApiResponse.error(
        'Failed to create group',
        error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  async findAll(@Query(ValidationPipe) queryDto: GroupQueryDto) {
    try {
      const result = await this.groupsService.findAll(queryDto);
      return ApiResponse.success(result, 'Groups retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        'Failed to retrieve groups',
        error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('export')
  async exportDevices(
    @Query('format') format: 'pdf' | 'xlsx' | 'csv',
    @Res() res: Response,
  ): Promise<any> {
    try {
      const devices = await this.groupsService.findAllWithoutPagination();

      switch (format) {
        case 'csv':
          return this.groupsService.exportToCSV(devices, res);
        case 'xlsx':
          return this.groupsService.exportToXLSX(devices, res);
        case 'pdf':
          return this.groupsService.exportToPDF(devices, res);
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

  @Get('search')
  async search(@Query(ValidationPipe) queryDto: GroupQueryDto) {
    try {
      const result = await this.groupsService.findAll(queryDto);
      return ApiResponse.success(result, 'Groups retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        'Failed to retrieve groups',
        error.message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const group = await this.groupsService.findOne(id);
      return ApiResponse.success(group, 'Group retrieved successfully');
    } catch (error) {
      const statusCode = error.status || HttpStatus.BAD_REQUEST;
      return ApiResponse.error(
        'Failed to retrieve group',
        error.message,
        statusCode,
      );
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateGroupDto: UpdateGroupDto,
  ) {
    try {
      const group = await this.groupsService.update(id, updateGroupDto);
      return ApiResponse.success(group, 'Group updated successfully');
    } catch (error) {
      const statusCode = error.status || HttpStatus.BAD_REQUEST;
      return ApiResponse.error(
        'Failed to update group',
        error.message,
        statusCode,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.groupsService.remove(id);
      return ApiResponse.success(null, 'Group deleted successfully');
    } catch (error) {
      const statusCode = error.status || HttpStatus.BAD_REQUEST;
      return ApiResponse.error(
        'Failed to delete group',
        error.message,
        statusCode,
      );
    }
  }
}
