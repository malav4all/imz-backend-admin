import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Module,
  Permission,
  Role,
  RoleDocument,
  UserRole,
} from './schema/role-schema';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';
import { Response } from 'express';
import axios from 'axios';

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:9008/logs';

  constructor(@InjectModel(Role.name) private roleModel: Model<RoleDocument>) {}

  async onModuleInit() {
    await this.initializeDefaultRoles();
  }

  private async sendLog(logData: {
    method: string;
    url: string;
    statusCode: number;
    operation: string;
    resource: string;
    message: string;
    userId?: string;
    metadata?: any;
    responseTime?: number;
    isError?: boolean;
    errorMessage?: string;
    stackTrace?: string;
  }): Promise<void> {
    try {
      await axios.post(
        this.logsServiceUrl,
        {
          ...logData,
          timestamp: new Date(),
          ipAddress: 'internal',
          userAgent: 'role-service',
        },
        {
          timeout: 5000, // 5 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      // Silent fail - don't let logging break main functionality
      this.logger.warn(`Failed to send log to microservice: ${error.message}`);
    }
  }

  private async initializeDefaultRoles() {
    const startTime = Date.now();
    try {
      const defaultRoles = [
        {
          name: UserRole.SUPERADMIN,
          displayName: 'Super Admin',
          description: 'Full system access with all permissions',
          modulePermissions: this.getAllModulePermissions(),
          isActive: true,
          isSystem: true,
        },
        {
          name: UserRole.ADMIN,
          displayName: 'Admin',
          description: 'Administrative access with most permissions',
          modulePermissions: this.getAdminModulePermissions(),
          isActive: true,
          isSystem: true,
        },
        {
          name: UserRole.ADMIN_ASSISTANT,
          displayName: 'Admin Assistant',
          description: 'Limited administrative access',
          modulePermissions: this.getAdminAssistantModulePermissions(),
          isActive: true,
          isSystem: true,
        },
        {
          name: UserRole.USER,
          displayName: 'User',
          description: 'Basic user access',
          modulePermissions: this.getUserModulePermissions(),
          isActive: true,
          isSystem: true,
        },
      ];

      for (const role of defaultRoles) {
        await this.roleModel.findOneAndUpdate({ name: role.name }, role, {
          upsert: true,
          new: true,
        });
      }

      await this.sendLog({
        method: 'POST',
        url: '/roles/initialize',
        statusCode: 200,
        operation: 'INITIALIZE',
        resource: 'roles',
        message: 'Default roles initialized successfully',
        metadata: { rolesCount: defaultRoles.length },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      await this.sendLog({
        method: 'POST',
        url: '/roles/initialize',
        statusCode: 500,
        operation: 'INITIALIZE',
        resource: 'roles',
        message: 'Failed to initialize default roles',
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
        responseTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  private getAllModulePermissions() {
    return Object.values(Module).map((module) => ({
      module,
      permissions: Object.values(Permission),
    }));
  }

  private getAdminModulePermissions() {
    return Object.values(Module).map((module) => ({
      module,
      permissions:
        module === Module.SETTINGS
          ? [Permission.VIEW, Permission.UPDATE]
          : Object.values(Permission),
    }));
  }

  private getAdminAssistantModulePermissions() {
    return Object.values(Module).map((module) => ({
      module,
      permissions: [Module.USER, Module.ROLE].includes(module)
        ? [Permission.VIEW]
        : [
            Permission.VIEW,
            Permission.ADD,
            Permission.UPDATE,
            Permission.EXPORT,
          ],
    }));
  }

  private getUserModulePermissions() {
    return [
      {
        module: Module.PRODUCT,
        permissions: [Permission.VIEW],
      },
      {
        module: Module.ORDER,
        permissions: [Permission.VIEW, Permission.ADD],
      },
    ];
  }

  async create(createRoleDto: CreateRoleDto, userId?: string): Promise<Role> {
    const startTime = Date.now();
    try {
      const existingRole = await this.roleModel.findOne({
        name: createRoleDto.name,
      });

      if (existingRole) {
        await this.sendLog({
          method: 'POST',
          url: '/roles',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'role',
          message: `Role creation failed - name already exists: ${createRoleDto.name}`,
          userId,
          metadata: { roleName: createRoleDto.name },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Role with this name already exists',
        });
        throw new ConflictException('Role with this name already exists');
      }

      const role = new this.roleModel(createRoleDto);
      const savedRole = await role.save();

      await this.sendLog({
        method: 'POST',
        url: '/roles',
        statusCode: 201,
        operation: 'CREATE',
        resource: 'role',
        message: `Role created successfully: ${savedRole.name}`,
        userId,
        metadata: {
          roleId: savedRole._id,
          roleName: savedRole.name,
          displayName: savedRole.displayName,
        },
        responseTime: Date.now() - startTime,
      });

      return savedRole;
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        await this.sendLog({
          method: 'POST',
          url: '/roles',
          statusCode: 500,
          operation: 'CREATE',
          resource: 'role',
          message: 'Role creation failed due to server error',
          userId,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
          responseTime: Date.now() - startTime,
        });
      }
      throw error;
    }
  }

  async findAll(
    query: QueryRoleDto,
    userId?: string,
  ): Promise<PaginatedResponse<Role>> {
    const startTime = Date.now();
    try {
      const { page = 1, limit = 10, name, search, isActive } = query;
      const skip = (page - 1) * limit;

      const filter: any = {};

      if (name) {
        filter.name = name;
      }

      if (search) {
        filter.$or = [
          { displayName: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
        ];
      }

      if (isActive !== undefined) {
        filter.isActive = isActive;
      }

      const [roles, total] = await Promise.all([
        this.roleModel.find(filter).skip(skip).limit(limit).exec(),
        this.roleModel.countDocuments(filter),
      ]);

      const result = new PaginatedResponse(roles, page, limit, total);

      await this.sendLog({
        method: 'GET',
        url: '/roles',
        statusCode: 200,
        operation: 'READ',
        resource: 'roles',
        message: `Roles retrieved successfully`,
        userId,
        metadata: {
          page,
          limit,
          total,
          resultsCount: roles.length,
          filters: filter,
        },
        responseTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/roles',
        statusCode: 500,
        operation: 'READ',
        resource: 'roles',
        message: 'Failed to retrieve roles',
        userId,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
        responseTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  async findOne(id: string, userId?: string): Promise<Role> {
    const startTime = Date.now();
    try {
      const role = await this.roleModel.findById(id);

      if (!role) {
        await this.sendLog({
          method: 'GET',
          url: `/roles/${id}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'role',
          message: `Role not found with ID: ${id}`,
          userId,
          metadata: { roleId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Role not found',
        });
        throw new NotFoundException('Role not found');
      }

      await this.sendLog({
        method: 'GET',
        url: `/roles/${id}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'role',
        message: `Role retrieved successfully: ${role.name}`,
        userId,
        metadata: {
          roleId: role._id,
          roleName: role.name,
        },
        responseTime: Date.now() - startTime,
      });

      return role;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/roles/${id}`,
          statusCode: 500,
          operation: 'READ',
          resource: 'role',
          message: 'Failed to retrieve role',
          userId,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
          responseTime: Date.now() - startTime,
        });
      }
      throw error;
    }
  }

  async findByName(name: UserRole, userId?: string): Promise<Role> {
    const startTime = Date.now();
    try {
      const role = await this.roleModel.findOne({ name });

      if (!role) {
        await this.sendLog({
          method: 'GET',
          url: `/roles/by-name/${name}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'role',
          message: `Role not found with name: ${name}`,
          userId,
          metadata: { roleName: name },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Role not found',
        });
        throw new NotFoundException('Role not found');
      }

      await this.sendLog({
        method: 'GET',
        url: `/roles/by-name/${name}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'role',
        message: `Role retrieved by name successfully: ${name}`,
        userId,
        metadata: {
          roleId: role._id,
          roleName: role.name,
        },
        responseTime: Date.now() - startTime,
      });

      return role;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/roles/by-name/${name}`,
          statusCode: 500,
          operation: 'READ',
          resource: 'role',
          message: 'Failed to retrieve role by name',
          userId,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
          responseTime: Date.now() - startTime,
        });
      }
      throw error;
    }
  }

  async update(
    id: string,
    updateRoleDto: UpdateRoleDto,
    userId?: string,
  ): Promise<any> {
    const startTime = Date.now();
    try {
      const role = await this.roleModel.findById(id);

      if (!role) {
        await this.sendLog({
          method: 'PUT',
          url: `/roles/${id}`,
          statusCode: 404,
          operation: 'UPDATE',
          resource: 'role',
          message: `Role update failed - not found: ${id}`,
          userId,
          metadata: { roleId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Role not found',
        });
        throw new NotFoundException('Role not found');
      }

      if (role.isSystem && updateRoleDto.name) {
        await this.sendLog({
          method: 'PUT',
          url: `/roles/${id}`,
          statusCode: 400,
          operation: 'UPDATE',
          resource: 'role',
          message: `Role update failed - cannot change system role name: ${role.name}`,
          userId,
          metadata: {
            roleId: id,
            roleName: role.name,
            attemptedNewName: updateRoleDto.name,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Cannot change name of system role',
        });
        throw new BadRequestException('Cannot change name of system role');
      }

      const updated: any = await this.roleModel.findByIdAndUpdate(
        id,
        updateRoleDto,
        {
          new: true,
        },
      );

      await this.sendLog({
        method: 'PUT',
        url: `/roles/${id}`,
        statusCode: 200,
        operation: 'UPDATE',
        resource: 'role',
        message: `Role updated successfully: ${updated.name}`,
        userId,
        metadata: {
          roleId: updated._id,
          roleName: updated.name,
          updatedFields: Object.keys(updateRoleDto),
        },
        responseTime: Date.now() - startTime,
      });

      return updated;
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'PUT',
          url: `/roles/${id}`,
          statusCode: 500,
          operation: 'UPDATE',
          resource: 'role',
          message: 'Role update failed due to server error',
          userId,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
          responseTime: Date.now() - startTime,
        });
      }
      throw error;
    }
  }

  async remove(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();
    try {
      const role = await this.roleModel.findById(id);

      if (!role) {
        await this.sendLog({
          method: 'DELETE',
          url: `/roles/${id}`,
          statusCode: 404,
          operation: 'DELETE',
          resource: 'role',
          message: `Role deletion failed - not found: ${id}`,
          userId,
          metadata: { roleId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Role not found',
        });
        throw new NotFoundException('Role not found');
      }

      if (role.isSystem) {
        await this.sendLog({
          method: 'DELETE',
          url: `/roles/${id}`,
          statusCode: 400,
          operation: 'DELETE',
          resource: 'role',
          message: `Role deletion failed - cannot delete system role: ${role.name}`,
          userId,
          metadata: {
            roleId: id,
            roleName: role.name,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Cannot delete system role',
        });
        throw new BadRequestException('Cannot delete system role');
      }

      await this.roleModel.findByIdAndDelete(id);

      await this.sendLog({
        method: 'DELETE',
        url: `/roles/${id}`,
        statusCode: 200,
        operation: 'DELETE',
        resource: 'role',
        message: `Role deleted successfully: ${role.name}`,
        userId,
        metadata: {
          roleId: id,
          roleName: role.name,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'DELETE',
          url: `/roles/${id}`,
          statusCode: 500,
          operation: 'DELETE',
          resource: 'role',
          message: 'Role deletion failed due to server error',
          userId,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
          responseTime: Date.now() - startTime,
        });
      }
      throw error;
    }
  }

  async setInactive(id: string, userId?: string): Promise<Role> {
    const startTime = Date.now();
    try {
      const role = await this.roleModel.findById(id);

      if (!role) {
        await this.sendLog({
          method: 'PATCH',
          url: `/roles/${id}/deactivate`,
          statusCode: 404,
          operation: 'DEACTIVATE',
          resource: 'role',
          message: `Role deactivation failed - not found: ${id}`,
          userId,
          metadata: { roleId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Role not found',
        });
        throw new NotFoundException('Role not found');
      }

      if (role.isSystem) {
        await this.sendLog({
          method: 'PATCH',
          url: `/roles/${id}/deactivate`,
          statusCode: 400,
          operation: 'DEACTIVATE',
          resource: 'role',
          message: `Role deactivation failed - cannot deactivate system role: ${role.name}`,
          userId,
          metadata: {
            roleId: id,
            roleName: role.name,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Cannot deactivate system role',
        });
        throw new BadRequestException('Cannot deactivate system role');
      }

      role.isActive = false;
      const savedRole = await role.save();

      await this.sendLog({
        method: 'PATCH',
        url: `/roles/${id}/deactivate`,
        statusCode: 200,
        operation: 'DEACTIVATE',
        resource: 'role',
        message: `Role deactivated successfully: ${role.name}`,
        userId,
        metadata: {
          roleId: id,
          roleName: role.name,
        },
        responseTime: Date.now() - startTime,
      });

      return savedRole;
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'PATCH',
          url: `/roles/${id}/deactivate`,
          statusCode: 500,
          operation: 'DEACTIVATE',
          resource: 'role',
          message: 'Role deactivation failed due to server error',
          userId,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
          responseTime: Date.now() - startTime,
        });
      }
      throw error;
    }
  }

  async getAllModules(): Promise<Module[]> {
    return Object.values(Module);
  }

  async getAllPermissions(): Promise<Permission[]> {
    return Object.values(Permission);
  }

  async checkPermission(
    roleName: UserRole,
    module: Module,
    permission: Permission,
    userId?: string,
  ): Promise<boolean> {
    const startTime = Date.now();
    try {
      const role = await this.roleModel.findOne({
        name: roleName,
        isActive: true,
      });

      if (!role) {
        await this.sendLog({
          method: 'GET',
          url: `/roles/check-permission`,
          statusCode: 200,
          operation: 'CHECK_PERMISSION',
          resource: 'role',
          message: `Permission check - role not found or inactive: ${roleName}`,
          userId,
          metadata: {
            roleName,
            module,
            permission,
            result: false,
          },
          responseTime: Date.now() - startTime,
        });
        return false;
      }

      const modulePermission = role.modulePermissions.find(
        (mp) => mp.module === module,
      );

      if (!modulePermission) {
        await this.sendLog({
          method: 'GET',
          url: `/roles/check-permission`,
          statusCode: 200,
          operation: 'CHECK_PERMISSION',
          resource: 'role',
          message: `Permission check - module not found: ${module}`,
          userId,
          metadata: {
            roleName,
            module,
            permission,
            result: false,
          },
          responseTime: Date.now() - startTime,
        });
        return false;
      }

      const hasPermission = modulePermission.permissions.includes(permission);

      await this.sendLog({
        method: 'GET',
        url: `/roles/check-permission`,
        statusCode: 200,
        operation: 'CHECK_PERMISSION',
        resource: 'role',
        message: `Permission check completed`,
        userId,
        metadata: {
          roleName,
          module,
          permission,
          result: hasPermission,
        },
        responseTime: Date.now() - startTime,
      });

      return hasPermission;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: `/roles/check-permission`,
        statusCode: 500,
        operation: 'CHECK_PERMISSION',
        resource: 'role',
        message: 'Permission check failed due to server error',
        userId,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
        responseTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  async getPermissionMatrix(userId?: string): Promise<any> {
    const startTime = Date.now();
    try {
      const roles = await this.roleModel.find({ isActive: true });
      const modules = Object.values(Module);
      const permissions = Object.values(Permission);

      const matrix = {};

      for (const role of roles) {
        matrix[role.name] = {};
        for (const module of modules) {
          matrix[role.name][module] = {};
          const modulePermission = role.modulePermissions.find(
            (mp) => mp.module === module,
          );

          for (const permission of permissions) {
            matrix[role.name][module][permission] =
              modulePermission?.permissions.includes(permission) || false;
          }
        }
      }

      await this.sendLog({
        method: 'GET',
        url: `/roles/permission-matrix`,
        statusCode: 200,
        operation: 'READ',
        resource: 'permission-matrix',
        message: 'Permission matrix retrieved successfully',
        userId,
        metadata: {
          rolesCount: roles.length,
          modulesCount: modules.length,
          permissionsCount: permissions.length,
        },
        responseTime: Date.now() - startTime,
      });

      return matrix;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: `/roles/permission-matrix`,
        statusCode: 500,
        operation: 'READ',
        resource: 'permission-matrix',
        message: 'Failed to retrieve permission matrix',
        userId,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
        responseTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  async findAllWithoutPagination(userId?: string): Promise<Role[]> {
    const startTime = Date.now();
    try {
      const roles = await this.roleModel.find().exec();

      await this.sendLog({
        method: 'GET',
        url: `/roles/all`,
        statusCode: 200,
        operation: 'READ',
        resource: 'roles',
        message: 'All roles retrieved successfully',
        userId,
        metadata: { rolesCount: roles.length },
        responseTime: Date.now() - startTime,
      });

      return roles;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: `/roles/all`,
        statusCode: 500,
        operation: 'READ',
        resource: 'roles',
        message: 'Failed to retrieve all roles',
        userId,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
        responseTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  exportToPDF(roles: Role[], res: Response, userId?: string): void {
    const startTime = Date.now();
    try {
      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=roles.pdf');

      doc.pipe(res);

      // Title
      doc
        .fontSize(18)
        .text('Role Permissions Matrix', { align: 'center' })
        .moveDown(1);

      // Prepare matrix data
      const modules = Object.values(Module);
      const permissions = Object.values(Permission);

      // For each role, create a section
      roles.forEach((role, roleIndex) => {
        if (roleIndex > 0) {
          doc.addPage();
        }

        // Role header
        doc.fontSize(14).text(`Role: ${role.displayName}`, { underline: true });
        doc.fontSize(10).text(`Description: ${role.description}`);
        doc
          .fontSize(10)
          .text(`Status: ${role.isActive ? 'Active' : 'Inactive'}`);
        doc
          .fontSize(10)
          .text(`System Role: ${role.isSystem ? 'Yes' : 'No'}`)
          .moveDown(1);

        // Permissions table
        doc
          .fontSize(12)
          .text('Module Permissions:', { underline: true })
          .moveDown(0.5);

        // Table headers
        const startY = doc.y;
        let currentY = startY;

        // Draw module column header
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Module', 50, currentY, { width: 100 });

        // Draw permission headers
        let x = 150;
        permissions.forEach((permission) => {
          doc.text(permission, x, currentY, { width: 60, align: 'center' });
          x += 60;
        });

        currentY += 20;

        // Draw horizontal line
        doc.moveTo(50, currentY).lineTo(450, currentY).stroke();
        currentY += 10;

        // Draw permissions for each module
        doc.font('Helvetica').fontSize(10);

        modules.forEach((module) => {
          // Module name
          doc.text(module, 50, currentY, { width: 100 });

          // Permission checkmarks
          const modulePermission = role.modulePermissions.find(
            (mp) => mp.module === module,
          );
          x = 150;

          permissions.forEach((permission) => {
            const hasPermission =
              modulePermission?.permissions.includes(permission) || false;
            doc.text(hasPermission ? '✓' : '✗', x, currentY, {
              width: 60,
              align: 'center',
            });
            x += 60;
          });

          currentY += 20;

          // Add new page if needed
          if (currentY > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            currentY = doc.page.margins.top;
          }
        });
      });

      doc.end();

      this.sendLog({
        method: 'GET',
        url: `/roles/export/pdf`,
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'roles',
        message: 'Roles exported to PDF successfully',
        userId,
        metadata: {
          format: 'PDF',
          rolesCount: roles.length,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      this.sendLog({
        method: 'GET',
        url: `/roles/export/pdf`,
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'roles',
        message: 'PDF export failed',
        userId,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
        responseTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  exportToCSV(roles: Role[], res: Response): void {
    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=roles_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // Prepare headers
      const modules = Object.values(Module);
      const permissions = Object.values(Permission);
      const headers = [
        'Role',
        'Display Name',
        'Description',
        'Status',
        'System Role',
      ];

      // Add module-permission headers
      modules.forEach((module) => {
        permissions.forEach((permission) => {
          headers.push(`${module}_${permission}`);
        });
      });

      // CSV configuration
      const csvStream = format({
        headers: headers,
        writeHeaders: true,
        delimiter: ',',
        quote: '"',
        escape: '"',
        includeEndRowDelimiter: true,
      });

      // Pipe CSV stream to response
      csvStream.pipe(res);

      // Write data rows
      roles.forEach((role) => {
        const row: any = {
          Role: role.name,
          'Display Name': role.displayName,
          Description: role.description,
          Status: role.isActive ? 'Active' : 'Inactive',
          'System Role': role.isSystem ? 'Yes' : 'No',
        };

        // Add module permissions
        modules.forEach((module) => {
          const modulePermission = role.modulePermissions.find(
            (mp) => mp.module === module,
          );
          permissions.forEach((permission) => {
            const key = `${module}_${permission}`;
            row[key] = modulePermission?.permissions.includes(permission)
              ? 'Yes'
              : 'No';
          });
        });

        csvStream.write(row);
      });

      csvStream.end();
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      }
    }
  }

  async exportToXLSX(roles: Role[], res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Role Management System';
      workbook.created = new Date();

      // Create overview worksheet
      const overviewSheet = workbook.addWorksheet('Roles Overview', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns for overview
      overviewSheet.columns = [
        { header: 'Role Name', key: 'name', width: 20 },
        { header: 'Display Name', key: 'displayName', width: 25 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'System Role', key: 'isSystem', width: 15 },
        { header: 'Created At', key: 'createdAt', width: 20 },
        { header: 'Updated At', key: 'updatedAt', width: 20 },
      ];

      // Style header row
      overviewSheet.getRow(1).eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' },
        };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Add role data
      roles.forEach((role: any) => {
        const row = overviewSheet.addRow({
          name: role.name,
          displayName: role.displayName,
          description: role.description,
          status: role.isActive ? 'Active' : 'Inactive',
          isSystem: role.isSystem ? 'Yes' : 'No',
          createdAt: role.createdAt,
          updatedAt: role.updatedAt,
        });

        // Style data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active roles
          if (cell.value === 'Active') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' },
            };
          }
        });
      });

      // Create permissions matrix worksheet
      const matrixSheet = workbook.addWorksheet('Permissions Matrix', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Prepare matrix columns
      const modules = Object.values(Module);
      const permissions = Object.values(Permission);
      const matrixColumns = [
        { header: 'Role / Module', key: 'role', width: 25 },
      ];

      // Add module-permission columns
      modules.forEach((module) => {
        permissions.forEach((permission) => {
          matrixColumns.push({
            header: `${module}\n${permission}`,
            key: `${module}_${permission}`,
            width: 15,
          });
        });
      });

      matrixSheet.columns = matrixColumns;

      // Style matrix header row
      matrixSheet.getRow(1).height = 30;
      matrixSheet.getRow(1).eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' },
        };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
          textRotation: 0,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Add permission data
      roles.forEach((role) => {
        const rowData: any = { role: role.displayName };

        modules.forEach((module) => {
          const modulePermission = role.modulePermissions.find(
            (mp) => mp.module === module,
          );
          permissions.forEach((permission) => {
            const key = `${module}_${permission}`;
            rowData[key] = modulePermission?.permissions.includes(permission)
              ? '✓'
              : '✗';
          });
        });

        const row = matrixSheet.addRow(rowData);

        // Style permission cells
        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          if (colNumber > 1) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };

            // Color code permissions
            if (cell.value === '✓') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFC6EFCE' }, // Light green
              };
              cell.font = { color: { argb: 'FF008000' } };
            } else {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFC7CE' }, // Light red
              };
              cell.font = { color: { argb: 'FFFF0000' } };
            }
          }
        });
      });

      // Freeze panes
      overviewSheet.views = [{ state: 'frozen', ySplit: 1 }];
      matrixSheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

      // Auto-filter
      overviewSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: overviewSheet.columnCount },
      };

      // Set response headers
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=roles_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).send('Error generating Excel file');
      }
    }
  }
}
