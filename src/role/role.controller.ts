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
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { ApiResponse } from 'src/comman/api-response';
import { UpdateRoleDto } from './dto/update-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { Response } from 'express';

@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  async create(@Body() createRoleDto: CreateRoleDto) {
    try {
      const role = await this.roleService.create(createRoleDto);
      return ApiResponse.success(
        role,
        'Role created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  async findAll(@Query() query: QueryRoleDto) {
    try {
      const result = await this.roleService.findAll(query);
      return ApiResponse.success(result, 'Roles fetched successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }
  @Get('search')
  async search(@Query() query: QueryRoleDto) {
    try {
      const result = await this.roleService.findAll(query);
      return ApiResponse.success(result, 'Roles fetched successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('export')
  async exportRoles(
    @Query('format') format: 'pdf' | 'xlsx' | 'csv',
    @Res() res: Response,
  ): Promise<any> {
    try {
      const roles = await this.roleService.findAllWithoutPagination();

      switch (format) {
        case 'csv':
          return this.roleService.exportToCSV(roles, res);
        case 'xlsx':
          return this.roleService.exportToXLSX(roles, res);
        case 'pdf':
          return this.roleService.exportToPDF(roles, res);
        default:
          return res
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: 'Invalid format' });
      }
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to export roles',
        error: error.message,
      });
    }
  }

  @Get('modules')
  async getAllModules() {
    try {
      const modules = await this.roleService.getAllModules();
      return ApiResponse.success(modules, 'Modules fetched successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('permissions')
  async getAllPermissions() {
    try {
      const permissions = await this.roleService.getAllPermissions();
      return ApiResponse.success(
        permissions,
        'Permissions fetched successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('permission-matrix')
  async getPermissionMatrix() {
    try {
      const matrix = await this.roleService.getPermissionMatrix();
      return ApiResponse.success(
        matrix,
        'Permission matrix fetched successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const role = await this.roleService.findOne(id);
      return ApiResponse.success(role, 'Role fetched successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    try {
      const role = await this.roleService.update(id, updateRoleDto);
      return ApiResponse.success(role, 'Role updated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch(':id/inactive')
  async setInactive(@Param('id') id: string) {
    try {
      const role = await this.roleService.setInactive(id);
      return ApiResponse.success(role, 'Role deactivated successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.roleService.remove(id);
      return ApiResponse.success(null, 'Role deleted successfully');
    } catch (error) {
      return ApiResponse.error(
        error.message,
        error.stack,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }
}
