#!/bin/bash

# SafeSpot Sentinel Global V2 - Database Initialization Script
# Initializes PostgreSQL with PostGIS extension and test database

set -e

echo "🗄️ Initializing PostgreSQL databases..."

# Create main database if it doesn't exist
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Enable PostGIS extension
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS postgis_topology;
    CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder;
    
    -- Create additional functions for spatial queries
    CREATE OR REPLACE FUNCTION calculate_distance(lat1 float, lon1 float, lat2 float, lon2 float)
    RETURNS float AS \$\$
    BEGIN
        RETURN ST_Distance(
            ST_GeogFromText('POINT(' || lon1 || ' ' || lat1 || ')'),
            ST_GeogFromText('POINT(' || lon2 || ' ' || lat2 || ')')
        );
    END;
    \$\$ LANGUAGE plpgsql;
    
    -- Create function to check if point is in any danger zone
    CREATE OR REPLACE FUNCTION check_point_danger(lat float, lon float)
    RETURNS TABLE(zone_id uuid, zone_level text, zone_name text) AS \$\$
    BEGIN
        RETURN QUERY
        SELECT z.id, z.level::text, z.name
        FROM zones z
        WHERE ST_Contains(z.geom, ST_Point(lon, lat))
        AND z.is_active = true
        AND z.valid_from <= NOW()
        AND (z.valid_to IS NULL OR z.valid_to >= NOW())
        ORDER BY 
            CASE z.level 
                WHEN 'RED' THEN 1 
                WHEN 'ORANGE' THEN 2 
                WHEN 'GREEN' THEN 3 
                ELSE 4 
            END;
    END;
    \$\$ LANGUAGE plpgsql;
    
    -- Create function for nearby reports search
    CREATE OR REPLACE FUNCTION get_nearby_reports(lat float, lon float, radius_m int DEFAULT 5000)
    RETURNS TABLE(
        report_id uuid,
        title text,
        report_type text,
        distance_m float,
        trust_score int,
        created_at timestamptz
    ) AS \$\$
    BEGIN
        RETURN QUERY
        SELECT 
            r.id,
            r.title,
            r.type::text,
            ST_Distance(r.geom::geography, ST_Point(lon, lat)::geography) as distance_m,
            r.trust_score,
            r.created_at
        FROM reports r
        WHERE r.deleted_at IS NULL
        AND r.status = 'VALIDATED'
        AND ST_DWithin(
            r.geom::geography,
            ST_Point(lon, lat)::geography,
            radius_m
        )
        ORDER BY distance_m ASC;
    END;
    \$\$ LANGUAGE plpgsql;
    
    -- Grant permissions
    GRANT USAGE ON SCHEMA public TO "$POSTGRES_USER";
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "$POSTGRES_USER";
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "$POSTGRES_USER";
    
    SELECT 'Main database initialized with PostGIS' as status;
EOSQL

# Create test database if POSTGRES_MULTIPLE_DATABASES is set
if [ -n "$POSTGRES_MULTIPLE_DATABASES" ]; then
    echo "Creating additional databases: $POSTGRES_MULTIPLE_DATABASES"
    
    for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
        echo "Creating database: $db"
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
            CREATE DATABASE "$db";
EOSQL
        
        # Enable PostGIS for test database
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
            CREATE EXTENSION IF NOT EXISTS postgis;
            CREATE EXTENSION IF NOT EXISTS postgis_topology;
            SELECT 'PostGIS enabled for $db' as status;
EOSQL
    done
fi

echo "✅ Database initialization completed successfully!"
echo "📊 PostGIS version info:"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT PostGIS_Version();"