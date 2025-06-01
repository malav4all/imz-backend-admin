import { SetMetadata } from '@nestjs/common';
import { Module, Permission } from 'src/role/schema/role-schema';

export const RequirePermission = (module: Module, permission: Permission) =>
  SetMetadata('permission', { module, permission });

// Example usage in a controller:
/*
@Controller('products')
export class ProductController {
  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(Module.PRODUCT, Permission.ADD)
  async create(@Body() createProductDto: CreateProductDto) {
    // Implementation
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(Module.PRODUCT, Permission.VIEW)
  async findAll() {
    // Implementation
  }
}
*/
